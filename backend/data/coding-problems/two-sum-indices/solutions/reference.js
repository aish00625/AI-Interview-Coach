const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const n = t[0]; const a = t.slice(1, 1 + n); const target = t[1 + n];
const seen = new Map();
for (let i = 0; i < n; i++) {
  if (seen.has(target - a[i])) { console.log(seen.get(target - a[i]) + ' ' + i); break; }
  seen.set(a[i], i);
}
