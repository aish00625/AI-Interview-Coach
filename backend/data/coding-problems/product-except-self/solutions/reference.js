const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const a = L[1].trim().split(/\s+/).map(BigInt);
const pre = new Array(n).fill(1n), suf = new Array(n).fill(1n);
for (let i = 1; i < n; i++) pre[i] = pre[i - 1] * a[i - 1];
for (let i = n - 2; i >= 0; i--) suf[i] = suf[i + 1] * a[i + 1];
console.log(a.map((_, i) => (pre[i] * suf[i]).toString()).join(' '));
