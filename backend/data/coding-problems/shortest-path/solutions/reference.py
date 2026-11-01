import sys, heapq
d = sys.stdin.read().split(); n, m = int(d[0]), int(d[1])
adj = [[] for _ in range(n + 1)]; p = 2
for _ in range(m):
    u, v, w = int(d[p]), int(d[p + 1]), int(d[p + 2]); p += 3
    adj[u].append((v, w)); adj[v].append((u, w))
s, t = int(d[p]), int(d[p + 1])
INF = float('inf'); dist = [INF] * (n + 1); dist[s] = 0; heap = [(0, s)]
while heap:
    du, u = heapq.heappop(heap)
    if du > dist[u]: continue
    if u == t: break
    for v, w in adj[u]:
        if du + w < dist[v]:
            dist[v] = du + w; heapq.heappush(heap, (dist[v], v))
print(-1 if dist[t] == INF else dist[t])
