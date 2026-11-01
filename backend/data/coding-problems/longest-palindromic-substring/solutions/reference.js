const L = require('fs').readFileSync(0, 'utf8').split('\n');
const s = L[0].trim(); const n = s.length; let best = 1;
function ex(l, r) { while (l >= 0 && r < n && s[l] === s[r]) { l--; r++; } return r - l - 1; }
for (let i = 0; i < n; i++) best = Math.max(best, ex(i, i), ex(i, i + 1));
console.log(String(best));
