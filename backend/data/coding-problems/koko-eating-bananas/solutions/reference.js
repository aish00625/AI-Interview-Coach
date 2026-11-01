const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, h] = L[0].trim().split(/\s+/).map(Number); const p = L[1].trim().split(/\s+/).map(Number);
let lo = 1, hi = Math.max(...p);
while (lo < hi) { const m = Math.floor((lo + hi) / 2); let s = 0; for (const x of p) s += Math.ceil(x / m); if (s <= h) hi = m; else lo = m + 1; }
console.log(String(lo));
