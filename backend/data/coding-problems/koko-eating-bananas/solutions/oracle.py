n, h = map(int, input().split()); p = list(map(int, input().split()))
k = 1
while True:
    if sum(-(-x // k) for x in p) <= h: print(k); break
    k += 1
