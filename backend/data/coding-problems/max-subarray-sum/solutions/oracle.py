import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1 + n]))
best = None
for i in range(n):
    s = 0
    for j in range(i, n):
        s += a[j]
        if best is None or s > best: best = s
print(best)
