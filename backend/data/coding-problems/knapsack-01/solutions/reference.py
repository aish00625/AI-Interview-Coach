import sys
data = sys.stdin.read().split(); n, W = int(data[0]), int(data[1])
dp = [0] * (W + 1)
for i in range(n):
    wt, val = int(data[2 + 2 * i]), int(data[3 + 2 * i])
    for w in range(W, wt - 1, -1):
        dp[w] = max(dp[w], dp[w - wt] + val)
print(dp[W])
