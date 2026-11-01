import sys
from functools import lru_cache
sys.setrecursionlimit(10000)
n = int(input()); a = list(map(int, input().split()))
@lru_cache(None)
def f(i):
    if i >= n: return 0
    return max(a[i] + f(i + 2), f(i + 1))
print(f(0))
