n, t = map(int, input().split()); a = list(map(int, input().split()))
lo, hi = 0, n - 1; ans = -1
while lo <= hi:
    mid = (lo + hi) // 2
    if a[mid] == t: ans = mid; break
    if a[lo] <= a[mid]:
        if a[lo] <= t < a[mid]: hi = mid - 1
        else: lo = mid + 1
    else:
        if a[mid] < t <= a[hi]: lo = mid + 1
        else: hi = mid - 1
print(ans)
