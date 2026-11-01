import sys
from functools import lru_cache
sys.setrecursionlimit(10000)
a = sys.stdin.readline().strip(); b = sys.stdin.readline().strip()
@lru_cache(maxsize=None)
def f(i, j):            # distance between suffixes a[i:] and b[j:]
    if i == len(a): return len(b) - j
    if j == len(b): return len(a) - i
    if a[i] == b[j]: return f(i + 1, j + 1)
    return 1 + min(f(i + 1, j + 1), f(i + 1, j), f(i, j + 1))
print(f(0, 0))
