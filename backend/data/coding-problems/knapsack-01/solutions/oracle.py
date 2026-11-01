import sys
from functools import lru_cache
data = sys.stdin.read().split(); n, W = int(data[0]), int(data[1])
items = [(int(data[2 + 2 * i]), int(data[3 + 2 * i])) for i in range(n)]
@lru_cache(None)
def best(i, cap):
    if i == n: return 0
    r = best(i + 1, cap)
    if items[i][0] <= cap: r = max(r, items[i][1] + best(i + 1, cap - items[i][0]))
    return r
print(best(0, W))
