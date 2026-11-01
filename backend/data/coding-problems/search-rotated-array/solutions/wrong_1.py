n, t = map(int, input().split()); a = list(map(int, input().split()))
lo, hi = 0, n - 1; ans = -1
while lo <= hi:  # BUG: ordinary binary search ignores the rotation
    mid = (lo + hi) // 2
    if a[mid] == t: ans = mid; break
    if a[mid] < t: lo = mid + 1
    else: hi = mid - 1
print(ans)
