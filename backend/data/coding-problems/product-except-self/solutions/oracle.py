n = int(input()); a = list(map(int, input().split()))
out = []
for i in range(n):
    p = 1
    for j in range(n):
        if j != i: p *= a[j]
    out.append(p)
print(' '.join(map(str, out)))
