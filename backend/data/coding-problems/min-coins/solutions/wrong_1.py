import sys
d = sys.stdin.read().split(); n, amount = int(d[0]), int(d[1]); coins = sorted(map(int, d[2:2 + n]), reverse=True)
count = 0
for c in coins:                  # BUG: greedy largest-first is not optimal for every coin system
    count += amount // c; amount %= c
print(count if amount == 0 else -1)
