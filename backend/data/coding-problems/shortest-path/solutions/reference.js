const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const n = t[0], m = t[1]; const adj = Array.from({ length: n + 1 }, () => []); let p = 2;
for (let i = 0; i < m; i++) { const u = t[p], v = t[p + 1], w = t[p + 2]; p += 3; adj[u].push([v, w]); adj[v].push([u, w]); }
const s = t[p], dest = t[p + 1];
const INF = Infinity; const dist = new Array(n + 1).fill(INF); dist[s] = 0;
// simple binary heap of [dist, node]
const heap = [[0, s]];
const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, b = i; if (l < heap.length && heap[l][0] < heap[b][0]) b = l; if (r < heap.length && heap[r][0] < heap[b][0]) b = r; if (b === i) break; [heap[b], heap[i]] = [heap[i], heap[b]]; i = b; } } return top; };
while (heap.length) {
  const [du, u] = pop();
  if (du > dist[u]) continue;
  if (u === dest) break;
  for (const [v, w] of adj[u]) if (du + w < dist[v]) { dist[v] = du + w; push([dist[v], v]); }
}
console.log(String(dist[dest] === INF ? -1 : dist[dest]));
