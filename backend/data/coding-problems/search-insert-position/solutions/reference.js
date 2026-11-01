const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, t] = L[0].trim().split(/\s+/).map(Number); const a = L[1].trim().split(/\s+/).map(Number);
let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < t) lo = m + 1; else hi = m; }
console.log(String(lo));
