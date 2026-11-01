n, h = map(int, input().split()); p = list(map(int, input().split()))
lo, hi = 1, max(p)
while lo < hi:
    mid = (lo + hi) // 2
    if sum(x // mid for x in p) <= h: hi = mid  # BUG: rounds hours down instead of up
    else: lo = mid + 1
print(lo)
