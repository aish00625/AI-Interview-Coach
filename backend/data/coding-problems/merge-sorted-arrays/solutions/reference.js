const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const n = t[0], m = t[1]; const a = t.slice(2, 2 + n), b = t.slice(2 + n, 2 + n + m);
let i = 0, j = 0; const out = [];
while (i < n && j < m) out.push(a[i] <= b[j] ? a[i++] : b[j++]);
while (i < n) out.push(a[i++]);
while (j < m) out.push(b[j++]);
console.log(out.join(' '));
