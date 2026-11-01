import sys
d = sys.stdin.read().split(); n, m = int(d[0]), int(d[1]); p = 2; edges = []
for _ in range(m):
    u, v, w = int(d[p]), int(d[p + 1]), int(d[p + 2]); p += 3; edges += [(u, v, w), (v, u, w)]
s, t = int(d[p]), int(d[p + 1])
INF = float('inf'); dist = [INF] * (n + 1); dist[s] = 0
for _ in range(n):
    upd = False
    for u, v, w in edges:
        if dist[u] + w < dist[v]: dist[v] = dist[u] + w; upd = True
    if not upd: break
print(-1 if dist[t] == INF else dist[t])
