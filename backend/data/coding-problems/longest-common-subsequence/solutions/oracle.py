import sys
from functools import lru_cache
sys.setrecursionlimit(10000)
s = input().strip(); t = input().strip()
@lru_cache(None)
def f(i, j):
    if i == len(s) or j == len(t): return 0
    if s[i] == t[j]: return 1 + f(i + 1, j + 1)
    return max(f(i + 1, j), f(i, j + 1))
print(f(0, 0))
