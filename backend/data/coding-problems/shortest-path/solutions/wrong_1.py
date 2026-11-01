import sys
from collections import deque
d = sys.stdin.read().split(); n, m = int(d[0]), int(d[1])
adj = [[] for _ in range(n + 1)]; p = 2
for _ in range(m):
    u, v, w = int(d[p]), int(d[p + 1]), int(d[p + 2]); p += 3
    adj[u].append((v, w)); adj[v].append((u, w))
s, t = int(d[p]), int(d[p + 1])
hops = {s: 0}; q = deque([s])
while q:                                # BUG: breadth-first search counts roads, ignoring their costs
    u = q.popleft()
    for v, w in adj[u]:
        if v not in hops: hops[v] = hops[u] + 1; q.append(v)
print(hops.get(t, -1))
