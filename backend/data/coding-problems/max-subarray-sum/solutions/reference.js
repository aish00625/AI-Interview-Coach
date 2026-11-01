const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const n = t[0]; const a = t.slice(1, 1 + n);
let best = a[0], cur = a[0];
for (let i = 1; i < n; i++) { cur = Math.max(a[i], cur + a[i]); best = Math.max(best, cur); }
console.log(String(best));
