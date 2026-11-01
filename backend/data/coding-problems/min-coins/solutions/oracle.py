import sys
from collections import deque
d = sys.stdin.read().split(); n, amount = int(d[0]), int(d[1]); coins = list(map(int, d[2:2 + n]))
dist = {0: 0}; q = deque([0]); ans = -1 if amount != 0 else 0
while q and amount != 0:
    cur = q.popleft()
    for c in coins:
        nxt = cur + c
        if nxt <= amount and nxt not in dist:
            dist[nxt] = dist[cur] + 1; q.append(nxt)
            if nxt == amount: ans = dist[nxt]; q.clear(); break
print(ans)
