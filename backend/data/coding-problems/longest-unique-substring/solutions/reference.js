const s = require('fs').readFileSync(0, 'utf8').split('\n')[0].trim();
const last = new Map(); let left = 0, best = 0;
for (let r = 0; r < s.length; r++) {
  const c = s[r];
  if (last.has(c) && last.get(c) >= left) left = last.get(c) + 1;
  last.set(c, r);
  best = Math.max(best, r - left + 1);
}
console.log(String(best));
