n = int(input()); a = list(map(int, input().split()))
take, skip = 0, 0
for v in a:
    take, skip = skip + v, max(take, skip)
print(max(take, skip))
