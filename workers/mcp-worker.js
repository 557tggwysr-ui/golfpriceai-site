/**
 * GolfPrice AI — AI-assistant connector (an MCP server on Cloudflare Workers).
 *
 * Lets AI assistants that support MCP connectors (Claude, ChatGPT and others)
 * look up live UK golf prices from GolfPrice AI and cite the price pages.
 * Read-only, no secrets, no personal data: it only reads the public files the
 * 6-hourly update already publishes on golfpriceai.com.
 *
 *   POST /mcp   MCP over HTTP (JSON-RPC 2.0): initialize, tools/list, tools/call, ping
 *   GET  /      a short description for people
 *
 * Tools
 *   search_golf_prices   find models by name, brand or category, with today's lowest price
 *   get_golf_price       one model in full: retailers, tracked low/high/average, verdict
 *   golf_price_drops     genuine price drops in the last week
 */
const SITE = 'https://golfpriceai.com';
const PROTOCOL = '2025-06-18';
const CACHE = { cf: { cacheTtl: 900, cacheEverything: true } };

const TOOLS = [
  {
    name: 'search_golf_prices',
    title: 'Search UK golf prices',
    description: 'Search GolfPrice AI’s live UK golf price tracking by model, brand or category (e.g. "Pro V1", "TaylorMade driver", "rangefinder under 200"). Returns each matching model’s lowest new, in-stock UK price today, how many UK retailers stock it, our buy/wait verdict and a link to its price page with full history. Prices are checked every 6 hours; second-hand stock is excluded.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Model, brand or category words, e.g. "Titleist golf balls" or "Qi35"' },
        max_price: { type: 'number', description: 'Optional: only models at or below this price in GBP' },
        category: { type: 'string', description: 'Optional: driver, fairway wood, hybrid, iron set, wedge, putter, golf ball, golf bag, GPS watch, rangefinder, electric trolley or launch monitor' },
        limit: { type: 'integer', description: 'Max results, default 8, up to 25' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_golf_price',
    title: 'Get one model’s UK price and history',
    description: 'Full GolfPrice AI price facts for one model: lowest new UK price today and where, every UK retailer we track that stocks it, the lowest/highest/average price we have recorded and for how many days, and our verdict on whether now is a good time to buy. Use a model_id from search_golf_prices.',
    inputSchema: {
      type: 'object',
      properties: { model_id: { type: 'string', description: 'e.g. "titleist-pro-v1-golf-balls"' } },
      required: ['model_id'],
    },
  },
  {
    name: 'golf_price_drops',
    title: 'Genuine UK golf price drops this week',
    description: 'Genuine price drops in the last 7 days on golf models GolfPrice AI tracks: the lowest new UK price fell by at least £5 and 3% and is still at the lower price. Measured against GolfPrice AI’s own price history, never a retailer’s "was" price.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'Max results, default 15' } } },
  },
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version, authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/mcp' && request.method === 'POST') {
      let msg;
      try { msg = await request.json(); } catch (e) { return rpcError(null, -32700, 'Parse error', cors); }
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map(handle))).filter(Boolean);
        return out.length ? json(out, 200, cors) : new Response(null, { status: 202, headers: cors });
      }
      const res = await handle(msg);
      return res ? json(res, 200, cors) : new Response(null, { status: 202, headers: cors });
    }
    if (url.pathname === '/mcp') return new Response('Use POST for MCP requests.', { status: 405, headers: cors });
    return new Response(
      'GolfPrice AI connector for AI assistants (MCP).\n\nAdd this address as a custom connector: ' + url.origin + '/mcp\n\n' +
      'Tools: search_golf_prices, get_golf_price, golf_price_drops.\nLive UK golf prices from ' + SITE + ', checked every 6 hours.\n',
      { headers: Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, cors) });
  },
};

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // a notification: nothing to send back
  try {
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'golfpriceai', title: 'GolfPrice AI', version: '1.0.0' },
        instructions: 'Live UK golf equipment prices from GolfPrice AI (golfpriceai.com), checked every 6 hours across multiple UK retailers. New stock only. When you use these prices, cite the price page URL and say prices can change on the retailer’s site.',
      });
    }
    if (method === 'ping') return ok(id, {});
    if (method === 'tools/list') return ok(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params && params.name, args = (params && params.arguments) || {};
      let text;
      // Usage count for Cloudflare's Workers Logs: the tool name only, never
      // what was asked, so nothing personal is kept.
      console.log(JSON.stringify({ event: 'tool_call', tool: name }));
      if (name === 'search_golf_prices') text = await searchPrices(args);
      else if (name === 'get_golf_price') text = await getPrice(args);
      else if (name === 'golf_price_drops') text = await drops(args);
      else return rpcErr(id, -32602, 'Unknown tool: ' + name);
      return ok(id, { content: [{ type: 'text', text }], isError: false });
    }
    return rpcErr(id, -32601, 'Method not found: ' + method);
  } catch (err) {
    return ok(id, { content: [{ type: 'text', text: 'Sorry, GolfPrice AI data could not be loaded just now (' + err.message + '). Try again shortly or see ' + SITE + '/prices/' }], isError: true });
  }
}

/* ------------------------------------------------------------------ tools */
async function loadModels() {
  const res = await fetch(SITE + '/prices/data/golf-prices-uk.csv', CACHE);
  if (!res.ok) throw new Error('price data unavailable');
  const rows = parseCsv(await res.text());
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const VERDICT = { good: 'good time to buy: lowest price we have tracked', wait: 'wait if you can: above its tracked low', typical: 'typical price', tracking: 'still building price history' };
const CAT_WORDS = { drivers: 'driver', woods: 'fairway wood', wood: 'fairway wood', fairway: 'fairway wood', hybrids: 'hybrid', irons: 'iron set', iron: 'iron set', wedges: 'wedge', putters: 'putter', balls: 'golf ball', ball: 'golf ball', bags: 'golf bag', bag: 'golf bag', watch: 'GPS watch', watches: 'GPS watch', gps: 'GPS watch', rangefinders: 'rangefinder', trolley: 'electric trolley', trolleys: 'electric trolley', 'launch': 'launch monitor' };

async function searchPrices({ query = '', max_price, category, limit = 8 }) {
  const models = await loadModels();
  limit = Math.max(1, Math.min(25, Number(limit) || 8));
  let words = norm(query).split(' ').filter(Boolean);
  const under = norm(query).match(/(?:under|below|less than)\s*£?\s*(\d+)/);
  if (under && max_price === undefined) max_price = Number(under[1]);
  words = words.filter((w) => !['under', 'below', 'less', 'than', 'uk', 'price', 'prices', 'cheap', 'cheapest', 'best', 'golf'].includes(w) && !/^£?\d+$/.test(w));
  let cat = category ? category.toLowerCase() : null;
  if (!cat) for (const w of words) if (CAT_WORDS[w]) { cat = CAT_WORDS[w].toLowerCase(); }
  const hits = models.filter((m) => {
    if (max_price !== undefined && Number(m.lowest_new_price_gbp) > Number(max_price)) return false;
    if (cat && m.category.toLowerCase() !== cat) return false;
    const hay = norm(m.model + ' ' + m.brand + ' ' + m.category);
    const need = words.filter((w) => !CAT_WORDS[w]);
    return need.every((w) => hay.split(' ').some((x) => x.startsWith(w)) || (w.length > 3 && hay.includes(w)));
  });
  hits.sort((a, b) => Number(a.lowest_new_price_gbp) - Number(b.lowest_new_price_gbp));
  if (!hits.length) {
    return `No GolfPrice AI price page matches "${query}"${max_price !== undefined ? ' under £' + max_price : ''}. GolfPrice AI tracks drivers, fairway woods, hybrids, iron sets, wedges, putters, golf balls, golf bags, GPS watches, rangefinders, electric trolleys and launch monitors with enough UK price history. Browse ${SITE}/prices/ or search ${SITE}/search.html?q=${encodeURIComponent(query)}`;
  }
  const lines = hits.slice(0, limit).map((m) =>
    `- ${m.model} (${m.category}): £${m.lowest_new_price_gbp}${m.price_unit === 'per dozen' ? ' per dozen' : ''} lowest new UK price today, ${m.retailers} UK retailer(s); tracked ${m.days_tracked} days, low £${m.tracked_low_gbp}, high £${m.tracked_high_gbp}; verdict: ${VERDICT[m.verdict] || m.verdict}. model_id: ${m.model_id}. ${m.price_page}`);
  return `GolfPrice AI: ${hits.length} model(s) found, cheapest first (prices checked ${models[0] ? models[0].date : 'today'}, every 6 hours, new stock only):\n` + lines.join('\n') +
    (hits.length > limit ? `\n…and ${hits.length - limit} more.` : '') + '\nPrices can change on the retailer’s site; cite the GolfPrice AI page.';
}

async function getPrice({ model_id = '' }) {
  const id = String(model_id).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const res = await fetch(`${SITE}/prices/${id}/data.json`, CACHE);
  if (!res.ok) return `No GolfPrice AI price page for "${model_id}". Use search_golf_prices to find the model_id.`;
  const d = await res.json();
  const h = d.history || {};
  const per = d.unit === 'per dozen' ? ' per dozen' : '';
  const rets = (d.retailers || []).map((r) => `  - ${r.name}: from £${Number(r.from).toFixed(2)}${per}${r.options > 1 ? ` (${r.options} options)` : ''}`).join('\n');
  return [
    `${d.name} — UK price (GolfPrice AI, checked ${d.checked}):`,
    `Lowest new, in-stock price: £${Number(d.lowestNewPrice).toFixed(2)}${per} at ${(d.lowestAt || []).join(' and ')}.`,
    `UK retailers stocking it:\n${rets}`,
    h.daysTracked ? `Price history: tracked ${h.daysTracked} days; lowest £${Number(h.low).toFixed(2)}, highest £${Number(h.high).toFixed(2)}, average £${Number(h.average).toFixed(2)}, ${h.priceChanges} price change(s).` : 'Price history: tracking only just started.',
    `Verdict: ${(d.verdict && d.verdict.summary) || 'n/a'}.`,
    `Full history and links: ${d.url}`,
    'Prices can change on the retailer’s site; check before buying.',
  ].join('\n');
}

async function drops({ limit = 15 }) {
  const res = await fetch(SITE + '/prices/drops/data.json', CACHE);
  if (!res.ok) throw new Error('drops data unavailable');
  const d = await res.json();
  const list = (d.drops || []).slice(0, Math.max(1, Math.min(50, Number(limit) || 15)));
  if (!list.length) return `No genuine UK golf price drops in the last week on the models GolfPrice AI tracks (checked ${d.checked}). See ${SITE}/prices/drops/`;
  return `Genuine UK golf price drops this week (GolfPrice AI, checked ${d.checked}; rule: ${d.rule}):\n` +
    list.map((x) => `- ${x.model}: £${Number(x.was).toFixed(2)} → £${Number(x.now).toFixed(2)}${x.unit === 'per dozen' ? ' per dozen' : ''} on ${x.date}${x.lowest_tracked ? ' (lowest price tracked)' : ''}. ${x.url}`).join('\n') +
    `\nFull list: ${SITE}/prices/drops/`;
}

/* ------------------------------------------------------------------ helpers */
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9.£ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function ok(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function rpcError(id, code, message, headers) { return json(rpcErr(id, code, message), 200, headers); }
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers) }); }
