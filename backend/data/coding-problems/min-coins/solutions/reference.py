import sys
d = sys.stdin.read().split(); n, amount = int(d[0]), int(d[1]); coins = list(map(int, d[2:2 + n]))
INF = float('inf'); best = [0] + [INF] * amount
for a in range(1, amount + 1):
    for c in coins:
        if c <= a and best[a - c] + 1 < best[a]:
            best[a] = best[a - c] + 1
print(-1 if best[amount] == INF else best[amount])
