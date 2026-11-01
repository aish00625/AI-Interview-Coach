const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, k] = L[0].trim().split(/\s+/).map(Number);
const a = L[1].trim().split(/\s+/).map(Number);
const seen = new Map([[0, 1]]); let s = 0, ans = 0;
for (const v of a) { s += v; ans += seen.get(s - k) || 0; seen.set(s, (seen.get(s) || 0) + 1); }
console.log(String(ans));
