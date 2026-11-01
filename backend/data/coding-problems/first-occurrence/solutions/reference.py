import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1 + n])); x = int(d[1 + n])
lo, hi, ans = 0, n - 1, -1
while lo <= hi:
    mid = (lo + hi) // 2
    if a[mid] >= x:
        if a[mid] == x: ans = mid
        hi = mid - 1
    else:
        lo = mid + 1
print(ans)
