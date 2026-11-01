import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1 + n])); x = int(d[1 + n])
lo, hi = 0, n - 1
ans = -1
while lo <= hi:                 # BUG: plain binary search returns whichever copy it lands on, not the first
    mid = (lo + hi) // 2
    if a[mid] == x: ans = mid; break
    if a[mid] < x: lo = mid + 1
    else: hi = mid - 1
print(ans)
