// Social trends scout: what's trending right now, so the content engine can
// hop on the bandwagon with the right hashtags, sounds, formats and themes.
//
// Runs twice a week before the content plan (.github/workflows/agent-content.yml).
// Sources (all public, read-only; anything that fails is simply skipped):
//   * TikTok Creative Center (UK, last 7 days): trending hashtags, and trending
//     songs approved for business use (business accounts can only use the
//     commercial music library).
//   * YouTube (optional YOUTUBE_API_KEY, free): the most-watched golf videos
//     in the UK this week, and the UK trending chart. Their titles show the
//     formats people are watching (POV, tier lists, "guess the price"...).
//   * r/golf top posts this week: what golfers are talking about.
// Everything passes a safety filter (nothing political, tragic, criminal or
// about anyone's health). Output: data/agents/social-trends.json.
import fs from 'node:fs';

const OUT = 'data/agents/social-trends.json';
const UNSAFE = /\b(dies|died|death|dead|killed|kill|tragic|tragedy|crash|war|attack|election|vote|minister|government|police|court|arrest|charged|victims?|injur\w*|cancer|funeral|abuse|racis\w*|scandal|shooting|stabb\w*|missing|trump|starmer|labour|tory|conservative|israel|gaza|ukraine|russia|sex|nsfw|onlyfans)\b/i;
const GOLFY = /golf|pga|masters|ryder|lpga|liv|dpworld|fore|birdie|eagle|putt|driver|caddie|clubhouse|fairway|hole.?in.?one/i;
const FORMATS = {
  pov: /\bpov\b/i, 'tier list': /tier list|rank(ing|ed)? (every|all)|ranking/i, 'guess the price': /guess|higher or lower|how much/i,
  challenge: /challenge|\bvs\b|versus|beat (a|the|my)/i, 'expectation v reality': /expectation|reality|vs reality/i,
  'top 3 / countdown': /\btop (3|5|10)\b|best \d|\d things/i, 'day in the life': /day in the life|vlog|come with me/i,
  'reaction': /reacts?|reaction|rating|rate my/i, 'budget': /cheap|budget|£\d+|under £/i, 'tried it': /i tried|i bought|tested/i,
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { generated: new Date().toISOString().slice(0, 16) + 'Z', hashtags: [], songs: [], formats: {}, watching: [], golfTalk: [], sources: {} };

async function creativeCenter() {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { out.sources.tiktok = 'puppeteer missing'; return; }
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    const grab = async (url, match) => {
      const p = await b.newPage();
      const hits = [];
      p.on('response', async r => { if (match.test(r.url())) { try { hits.push(await r.json()); } catch { /* not json */ } } });
      await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
      await sleep(4000);
      const text = await p.evaluate(() => document.body.innerText).catch(() => '');
      await p.close();
      return { hits, text };
    };
    const h = await grab('https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?region=GB&period=7', /popular_trend\/hashtag/);
    for (const j of h.hits) for (const it of (j?.data?.list || [])) {
      const tag = it.hashtag_name || it.name; if (!tag || UNSAFE.test(tag)) continue;
      out.hashtags.push({ tag: '#' + tag.replace(/^#/, ''), views: it.video_views || it.publish_cnt || null, golf: GOLFY.test(tag), source: 'tiktok',
        // rising today: TikTok marks tags that are new to the chart or climbing fast
        rising: it.rank_diff_type === 4 || it.rank_diff_type === 'new' || it.is_new === true || (Number(it.rank_diff) || 0) >= 10,
        rankDiff: it.rank_diff ?? null });
    }
    if (!out.hashtags.length) for (const m of (h.text.match(/#[A-Za-z0-9_]{3,30}/g) || [])) if (!UNSAFE.test(m)) out.hashtags.push({ tag: m, golf: GOLFY.test(m), source: 'tiktok' });
    const s = await grab('https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en?region=GB&period=7&commercialMusic=true', /popular_trend\/sound|music/);
    for (const j of s.hits) for (const it of (j?.data?.sound_list || j?.data?.list || [])) {
      const title = it.title || it.song_name, artist = it.author || it.artist;
      if (!title || UNSAFE.test(title + ' ' + (artist || ''))) continue;
      out.songs.push({ title, artist: artist || '', businessOk: it.is_commercial !== false, link: it.link || null });
    }
    // trending videos (what people are actually watching), best effort: the page's data shape changes
    const v = await grab('https://ads.tiktok.com/business/creativecenter/inspiration/popular/pc/en?region=GB&period=7', /popular_trend\/list|popular_trend\/video|top_video/);
    out.videos = [];
    for (const j of v.hits) for (const it of (j?.data?.videos || j?.data?.list || [])) {
      const title = it.title || it.video_title || it.item_desc || '';
      if (title && !UNSAFE.test(title)) out.videos.push({ title: title.slice(0, 140), views: it.play_count || it.vv || null, golf: GOLFY.test(title) });
    }
    out.sources.tiktok = `${out.hashtags.length} hashtags (${out.hashtags.filter(h => h.rising).length} rising), ${out.songs.length} songs, ${out.videos.length} videos`;
  } catch (e) { out.sources.tiktok = 'failed: ' + e.message.slice(0, 80); }
  await b.close();
}

async function youtube() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) { out.sources.youtube = 'no key'; return; }
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const get = async u => { try { const r = await fetch(u); return r.ok ? r.json() : {}; } catch { return {}; } };
  const golf = await get(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=golf&regionCode=GB&relevanceLanguage=en&order=viewCount&publishedAfter=${since}&maxResults=50&key=${key}`);
  const titles = (golf.items || []).map(i => i.snippet.title.replace(/&#39;/g, "'").replace(/&amp;/g, '&')).filter(t => !UNSAFE.test(t));
  for (const [f, rx] of Object.entries(FORMATS)) out.formats[f] = titles.filter(t => rx.test(t)).length;
  out.golfVideos = titles.slice(0, 15);
  const chart = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=GB&maxResults=30&key=${key}`);
  out.watching = (chart.items || []).map(i => i.snippet.title).filter(t => !UNSAFE.test(t)).slice(0, 15);
  out.sources.youtube = `${titles.length} golf videos, ${out.watching.length} trending`;
}

async function reddit() {
  try {
    const r = await fetch('https://www.reddit.com/r/golf/top.json?t=week&limit=40', { headers: { 'User-Agent': 'GolfPriceAI-trends/1.0 (+https://golfpriceai.com)' } });
    const j = r.ok ? await r.json() : {};
    out.golfTalk = (j?.data?.children || []).map(c => c.data.title).filter(t => !UNSAFE.test(t)).slice(0, 20);
    for (const [f, rx] of Object.entries(FORMATS)) out.formats[f] = (out.formats[f] || 0) + out.golfTalk.filter(t => rx.test(t)).length;
    out.sources.reddit = `${out.golfTalk.length} posts`;
  } catch (e) { out.sources.reddit = 'failed'; }
}

await Promise.all([creativeCenter(), youtube(), reddit()]);
out.hashtags = out.hashtags.slice(0, 40);
out.songs = out.songs.filter(s => s.businessOk).slice(0, 20);
fs.mkdirSync('data/agents', { recursive: true });
// TREND_DAILY=1 (the newsroom's twice-daily run) writes a separate "today" file, so the weekly scout's file is kept
const file = process.env.TREND_DAILY === '1' ? 'data/agents/social-today.json' : OUT;
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.sources), 'formats:', JSON.stringify(out.formats));
