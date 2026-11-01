n, k = map(int, input().split()); a = list(map(int, input().split()))
print(sorted(a, reverse=True)[k - 1])
