import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1 + n]))
best = cur = 0               # BUG: starts at 0, so an empty run is allowed and all-negative input prints 0
for x in a:
    cur = max(0, cur + x); best = max(best, cur)
print(best)
