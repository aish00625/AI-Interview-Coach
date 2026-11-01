n, t = map(int, input().split()); a = list(map(int, input().split()))
lo, hi = 0, n - 1
while lo <= hi:
    mid = (lo + hi) // 2
    if a[mid] == t: print(mid); break
    if a[mid] < t: lo = mid + 1
    else: hi = mid - 1
else:
    print(-1)  # BUG: should print the insertion position
