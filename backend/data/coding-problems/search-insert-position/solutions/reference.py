n, t = map(int, input().split()); a = list(map(int, input().split()))
lo, hi = 0, n
while lo < hi:
    mid = (lo + hi) // 2
    if a[mid] < t: lo = mid + 1
    else: hi = mid
print(lo)
