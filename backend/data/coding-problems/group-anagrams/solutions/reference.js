const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const m = new Map();
for (let i = 1; i <= n; i++) { const w = L[i].trim(); const k = [...w].sort().join(''); if (!m.has(k)) m.set(k, []); m.get(k).push(w); }
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rows = [...m.values()].map((g) => g.sort(cmp)).sort((a, b) => cmp(a[0], b[0]));
console.log(rows.map((g) => g.join(' ')).join('\n'));
