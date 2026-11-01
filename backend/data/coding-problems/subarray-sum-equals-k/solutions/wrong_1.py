n, k = map(int, input().split()); a = list(map(int, input().split()))
ans = 0; l = 0; s = 0
for r in range(n):
    s += a[r]
    while s > k and l <= r:
        s -= a[l]; l += 1  # BUG: sliding window is only valid for non-negative numbers
    if s == k: ans += 1
print(ans)
