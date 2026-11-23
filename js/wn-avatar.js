/* GolfPrice AI: a Wild Nine golfer's head and shoulders, drawn from the small "look" snapshot the game
   saves (localStorage "wildnine-av") and sends with league scores. The same shapes as the game's golfer.
   window.wnAvatar(av, size) returns an SVG string; a missing look draws the default golfer. */
(function () {
  var SKINS = ['#f3d2b5', '#e0ac84', '#c68b5e', '#8d5a3b', '#5c3a26'];
  var HAIRS = ['#4a3426', '#1f1a17', '#a8743a', '#d9b26a', '#9a9a9a', '#b5432e'];
  var HAIRSTYLES = [
    ['Short back and sides', 'M122 132 Q124 106 150 106 Q176 106 178 132 Q170 118 150 118 Q130 118 122 132 Z', ''],
    ['Buzz cut', 'M121 131 Q123 109 150 109 Q177 109 179 131 Q170 122 150 122 Q130 122 121 131 Z', ''],
    ['Side parting', 'M120 138 Q117 104 150 103 Q183 104 180 138 Q177 117 160 113 L139 123 Q125 125 120 138 Z', ''],
    ['Quiff', 'M122 132 Q121 108 138 101 Q150 90 170 97 Q181 106 178 132 Q170 116 150 116 Q130 118 122 132 Z', ''],
    ['Curly', 'C', ''],
    ['Shoulder length', 'M118 140 Q116 104 150 103 Q184 104 182 140 L182 176 Q177 181 172 174 L172 134 Q160 117 150 117 Q140 117 128 134 L128 174 Q123 181 118 176 Z', ''],
    ['Ponytail', 'M120 140 Q118 104 150 104 Q182 104 180 140 Q174 116 150 116 Q126 116 120 140 Z', 'M176 122 Q200 130 196 166 Q192 182 184 176 Q190 150 172 132 Z'],
    ['Top bun', 'M121 134 Q122 106 150 105 Q178 106 179 134 Q170 118 150 118 Q130 118 121 134 Z', 'BUN'],
    ['Bob', 'M118 140 Q116 104 150 103 Q184 104 182 140 L182 160 Q173 165 170 156 L170 132 Q160 118 150 118 Q140 118 130 132 L130 156 Q127 165 118 160 Z', ''],
    ['Afro', 'M124 124 Q128 110 150 110 Q172 110 176 124 Q164 118 150 118 Q136 118 124 124 Z', 'AFRO'],
    ['Long and straight', 'M119 138 Q117 104 150 103 Q183 104 181 138 Q174 116 150 116 Q126 116 119 138 Z', 'M117 132 L117 206 Q150 214 183 206 L183 132 Z'],
    ['Clean shaven head', '', '']
  ];
  function shade(hex, amt) {
    var n = parseInt(String(hex || '#888888').slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt))); };
    return '#' + [f(r), f(g), f(b)].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }
  var uid = 0;
  window.wnAvatar = function (av, size) {
    av = av || {}; uid++;
    var hd = av.hd || { hat: 'cap', c: '#f4f4f0' }, tp = av.tp || { top: 'polo', c: '#f7f7f2' }, gl = av.ly || {}, ey = av.ey || {};
    var skin = SKINS[av.s || 0] || SKINS[0], hairC = HAIRS[av.h || 0] || HAIRS[0], fem = av.b === 'f';
    var dk = function (c) { return shade(c, -0.25); };
    var TORSO = fem ? 'M116 186 Q150 174 184 186 L180 226 Q188 250 190 272 L110 272 Q112 250 120 226 Z' : 'M112 186 Q150 172 188 186 L192 272 L108 272 Z';
    tp.c = tp.c || '#f7f7f2';
    var torso = '<path d="' + TORSO + '" fill="' + tp.c + '" stroke="' + dk(tp.c) + '" stroke-width="1.5"/>';
    if (tp.top === 'polo') torso += '<path d="M138 178 L150 196 L162 178 L158 176 L150 186 L142 176 Z" fill="' + shade(tp.c, -0.12) + '"/><circle cx="150" cy="200" r="1.8" fill="' + dk(tp.c) + '"/>';
    if (tp.top === 'qzip') torso += '<path d="M138 176 Q150 170 162 176 L160 186 Q150 182 140 186 Z" fill="' + dk(tp.c) + '"/><path d="M150 182 V214" stroke="#d9dde2" stroke-width="2"/>';
    if (tp.top === 'argyle') { var d = ''; for (var r = 0; r < 3; r++) for (var c = 0; c < 4; c++) d += '<path d="M' + (108 + c * 28) + ' ' + (200 + r * 28) + ' l14 -14 l14 14 l-14 14 z" fill="' + ((r + c) % 2 ? (tp.c2 || '#e3b23c') : shade(tp.c, 0.15)) + '" opacity=".9"/>';
      torso += '<clipPath id="wa' + uid + '"><path d="' + TORSO + '"/></clipPath><g clip-path="url(#wa' + uid + ')">' + d + '</g><path d="M140 178 L150 192 L160 178" fill="none" stroke="' + dk(tp.c) + '" stroke-width="3"/>'; }
    if (tp.top === 'rain') torso += '<path d="M150 178 V270" stroke="#555" stroke-width="2"/><path d="M128 178 Q150 160 172 178" fill="none" stroke="' + shade(tp.c, 0.2) + '" stroke-width="5"/>';
    if (gl.gilet && gl.c) {
      var GIL = fem ? 'M118 184 Q150 176 182 184 L178 226 Q186 250 188 272 L112 272 Q114 250 122 226 Z' : 'M114 184 Q150 174 186 184 L190 272 L110 272 Z';
      torso += '<path d="' + GIL + '" fill="' + gl.c + '" stroke="' + dk(gl.c) + '" stroke-width="1.5"/><path d="M136 176 Q150 186 164 176 L166 168 Q150 176 134 168 Z" fill="' + shade(gl.c, -0.1) + '" stroke="' + dk(gl.c) + '"/><path d="M150 178 V270" stroke="' + (gl.trim || shade(gl.c, 0.35)) + '" stroke-width="2"/>';
    }
    var neck = '<rect x="141" y="160" width="18" height="20" fill="' + skin + '"/>';
    var head = '<circle cx="150" cy="138" r="30" fill="' + skin + '"/><circle cx="120" cy="140" r="6" fill="' + skin + '"/><circle cx="180" cy="140" r="6" fill="' + skin + '"/>' +
      '<circle cx="139" cy="140" r="3" fill="#2b2b2b"/><circle cx="161" cy="140" r="3" fill="#2b2b2b"/><path d="M140 153 Q150 161 160 153" fill="none" stroke="#7a3b2a" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="133" cy="150" r="4" fill="#e88" opacity=".25"/><circle cx="167" cy="150" r="4" fill="#e88" opacity=".25"/>';
    var lens = ey.lens || '#2a2d33', fr = ey.frame || '#222222', eyes = '';
    if (ey.shades === 'round') eyes = '<circle cx="139" cy="140" r="7.5" fill="' + lens + '" stroke="' + fr + '" stroke-width="2"/><circle cx="161" cy="140" r="7.5" fill="' + lens + '" stroke="' + fr + '" stroke-width="2"/><path d="M146.5 139 Q150 136 153.5 139" stroke="' + fr + '" stroke-width="2" fill="none"/>';
    else if (ey.shades === 'wrap') eyes = '<path d="M124 134 Q150 128 176 134 L174 144 Q162 150 151 143 Q150 141 149 143 Q138 150 126 144 Z" fill="' + lens + '" stroke="' + fr + '" stroke-width="2.2"/>';
    else if (ey.shades === 'square') eyes = '<rect x="130" y="134" width="17" height="12" rx="2" fill="' + lens + '" stroke="' + fr + '" stroke-width="2.2"/><rect x="153" y="134" width="17" height="12" rx="2" fill="' + lens + '" stroke="' + fr + '" stroke-width="2.2"/><path d="M147 138 H153" stroke="' + fr + '" stroke-width="2"/>';
    else if (ey.shades) eyes = '<path d="M130 135 H147 Q148 147 139 148 Q130 147 130 135 Z M153 135 H170 Q170 147 161 148 Q152 147 153 135 Z" fill="' + lens + '" stroke="' + fr + '" stroke-width="1.8"/><path d="M147 136 Q150 134 153 136" stroke="' + fr + '" stroke-width="1.8" fill="none"/>';
    var HS = HAIRSTYLES[Math.min(HAIRSTYLES.length - 1, av.hs != null ? av.hs : (fem ? 6 : 0))];
    var hairBack = HS[2] === 'AFRO' ? '<circle cx="150" cy="128" r="42" fill="' + hairC + '"/>' : HS[2] === 'BUN' ? '<circle cx="150" cy="100" r="12" fill="' + hairC + '"/>' : HS[2] ? '<path d="' + HS[2] + '" fill="' + hairC + '"/>' : '';
    var curls = [[124, 124], [131, 113], [141, 107], [152, 105], [163, 107], [172, 113], [178, 123]].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="8" fill="' + hairC + '"/>'; }).join('');
    var hair = HS[1] === 'C' ? curls : HS[1] ? '<path d="' + HS[1] + '" fill="' + hairC + '"/>' : '';
    var lashes = fem ? '<path d="M134 136 l-3 -3 M137 135 l-1 -4 M166 136 l3 -3 M163 135 l1 -4" stroke="#2b2b2b" stroke-width="1.4"/>' : '';
    var hc = hd.c || '#f4f4f0', hat = '';
    if (hd.hat === 'cap') hat = '<path d="M118 128 Q120 96 150 96 Q180 96 182 128 Z" fill="' + hc + '" stroke="' + dk(hc) + '"/><path d="M118 127 Q150 118 196 130 Q170 138 118 132 Z" fill="' + shade(hc, -0.12) + '"/><circle cx="150" cy="97" r="3" fill="' + dk(hc) + '"/>';
    if (hd.hat === 'visor') hat = '<rect x="118" y="116" width="64" height="9" rx="4" fill="' + hc + '" stroke="#ccc"/><path d="M118 124 Q150 116 196 128 Q170 136 118 130 Z" fill="' + hc + '" stroke="#ccc"/>';
    if (hd.hat === 'bucket') hat = '<path d="M126 124 L132 98 Q150 92 168 98 L174 124 Z" fill="' + hc + '" stroke="' + dk(hc) + '"/><ellipse cx="150" cy="125" rx="40" ry="8" fill="' + shade(hc, -0.08) + '" stroke="' + dk(hc) + '"/>';
    if (hd.hat === 'beanie') hat = '<path d="M120 126 Q120 94 150 94 Q180 94 180 126 Z" fill="' + hc + '"/><rect x="118" y="118" width="64" height="12" rx="5" fill="' + shade(hc, -0.15) + '"/><circle cx="150" cy="90" r="9" fill="#fff"/>';
    if (hd.hat === 'flat') hat = '<path d="M118 126 Q122 104 150 104 Q178 104 186 120 Q194 126 186 128 L118 130 Z" fill="' + hc + '" stroke="' + dk(hc) + '"/>';
    if (hd.hat === 'bandana') hat = '<path d="M119 128 Q120 100 150 99 Q180 100 181 128 Q166 118 150 118 Q134 118 119 128 Z" fill="' + hc + '" stroke="' + dk(hc) + '"/><path d="M180 124 L196 120 L192 128 Z M180 126 L194 136 L186 138 Z" fill="' + hc + '" stroke="' + dk(hc) + '"/>';
    hat = hd.hat === 'visor' ? hair + hat : hair + hat;
    size = size || 56;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 76 108 132" width="' + size + '" height="' + Math.round(size * 132 / 108) + '" aria-hidden="true">' +
      torso + neck + hairBack + head + lashes + eyes + hat + '</svg>';
  };
})();
