import sys
n, k = map(int, sys.stdin.read().split())
MOD = 1_000_000_007
ways = [0] * (n + 1); ways[0] = 1
window = 1                      # sum of ways[i-k .. i-1]
for i in range(1, n + 1):
    ways[i] = window % MOD
    window = (window + ways[i]) % MOD
    if i - k >= 0:
        window = (window - ways[i - k]) % MOD
print(ways[n] % MOD)
