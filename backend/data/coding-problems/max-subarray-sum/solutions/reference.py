import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1 + n]))
best = cur = a[0]
for x in a[1:]:
    cur = max(x, cur + x)
    best = max(best, cur)
print(best)
