const L = require('fs').readFileSync(0, 'utf8').split('\n');
const s = L[0].trim(); const cnt = {}; const q = []; let out = '';
for (const c of s) { cnt[c] = (cnt[c] || 0) + 1; q.push(c); let h = 0; while (h < q.length && cnt[q[h]] > 1) h++; q.splice(0, h); out += q.length ? q[0] : '#'; }
console.log(out);
