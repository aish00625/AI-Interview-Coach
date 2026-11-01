const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, m] = L[0].trim().split(/\s+/).map(Number); const adj = Array.from({ length: n }, () => []); const indeg = new Array(n).fill(0);
for (let i = 1; i <= m; i++) { const [a, b] = L[i].trim().split(/\s+/).map(Number); adj[b].push(a); indeg[a]++; }
const q = []; for (let i = 0; i < n; i++) if (!indeg[i]) q.push(i);
let done = 0; for (let h = 0; h < q.length; h++) { done++; for (const v of adj[q[h]]) if (--indeg[v] === 0) q.push(v); }
console.log(done === n ? 'YES' : 'NO');
