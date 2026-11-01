const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, k] = L[0].trim().split(/\s+/).map(Number); const a = L[1].trim().split(/\s+/).map(Number);
const dq = new Array(n); let h = 0, t = 0; const out = [];
for (let i = 0; i < n; i++) {
  while (t > h && a[dq[t - 1]] <= a[i]) t--;
  dq[t++] = i;
  if (dq[h] <= i - k) h++;
  if (i >= k - 1) out.push(a[dq[h]]);
}
console.log(out.join(' '));
