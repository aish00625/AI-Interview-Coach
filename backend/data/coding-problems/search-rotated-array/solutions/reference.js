const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, t] = L[0].trim().split(/\s+/).map(Number); const a = L[1].trim().split(/\s+/).map(Number);
let lo = 0, hi = n - 1, ans = -1;
while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] === t) { ans = m; break; }
  if (a[lo] <= a[m]) { if (a[lo] <= t && t < a[m]) hi = m - 1; else lo = m + 1; } else { if (a[m] < t && t <= a[hi]) lo = m + 1; else hi = m - 1; } }
console.log(String(ans));
