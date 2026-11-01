n, t = map(int, input().split()); a = list(map(int, input().split()))
print(a.index(t) if t in a else -1)
