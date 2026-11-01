import sys
from collections import deque
data = sys.stdin.read().split(); n, m = int(data[0]), int(data[1])
adj = [[] for _ in range(n)]; indeg = [0] * n
for i in range(m):
    a, b = int(data[2 + 2 * i]), int(data[3 + 2 * i])
    adj[b].append(a); indeg[a] += 1
q = deque(i for i in range(n) if indeg[i] == 0); done = 0
while q:
    u = q.popleft(); done += 1
    for v in adj[u]:
        indeg[v] -= 1
        if indeg[v] == 0: q.append(v)
print('YES' if done == n else 'NO')
