const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const w = L.slice(1, 1 + n).map((s) => s.trim());
let p = w[0]; for (const x of w) while (!x.startsWith(p)) p = p.slice(0, -1);
console.log(p || 'NONE');
