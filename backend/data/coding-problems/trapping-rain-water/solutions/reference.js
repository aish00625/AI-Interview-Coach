const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const h = L[1].trim().split(/\s+/).map(Number);
const lm = new Array(n), rm = new Array(n);
lm[0] = h[0]; for (let i = 1; i < n; i++) lm[i] = Math.max(lm[i - 1], h[i]);
rm[n - 1] = h[n - 1]; for (let i = n - 2; i >= 0; i--) rm[i] = Math.max(rm[i + 1], h[i]);
let t = 0; for (let i = 0; i < n; i++) t += Math.min(lm[i], rm[i]) - h[i];
console.log(String(t));
