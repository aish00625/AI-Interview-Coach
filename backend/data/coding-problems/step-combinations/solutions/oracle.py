import sys
n, k = map(int, sys.stdin.read().split())
MOD = 1_000_000_007
dp = [0] * (n + 1); dp[0] = 1
for i in range(1, n + 1):
    dp[i] = sum(dp[i - s] for s in range(1, min(k, i) + 1)) % MOD
print(dp[n])
