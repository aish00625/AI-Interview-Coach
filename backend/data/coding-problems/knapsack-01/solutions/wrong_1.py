import sys
data = sys.stdin.read().split(); n, W = int(data[0]), int(data[1])
dp = [0] * (W + 1)
for i in range(n):
    wt, val = int(data[2 + 2 * i]), int(data[3 + 2 * i])
    for w in range(wt, W + 1):  # BUG: ascending order lets an item be used more than once
        dp[w] = max(dp[w], dp[w - wt] + val)
print(dp[W])
