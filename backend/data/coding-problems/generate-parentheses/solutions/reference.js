const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const out = [];
(function go(s, o, c) { if (s.length === 2 * n) { out.push(s); return; } if (o < n) go(s + '(', o + 1, c); if (c < o) go(s + ')', o, c + 1); })('', 0, 0);
console.log(out.join('\n'));
