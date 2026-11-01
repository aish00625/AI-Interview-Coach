const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const n = t[0]; const a = t.slice(1, 1 + n); const x = t[1 + n];
let lo = 0, hi = n - 1, ans = -1;
while (lo <= hi) {
  const mid = Math.floor((lo + hi) / 2);
  if (a[mid] >= x) { if (a[mid] === x) ans = mid; hi = mid - 1; } else lo = mid + 1;
}
console.log(String(ans));
