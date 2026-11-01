const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const a = L[1].trim().split(/\s+/).map(Number); const tails = [];
for (const v of a) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < v) lo = m + 1; else hi = m; } tails[lo] = v; }
console.log(String(tails.length));
