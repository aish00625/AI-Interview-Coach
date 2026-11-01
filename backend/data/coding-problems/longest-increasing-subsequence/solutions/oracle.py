n = int(input()); a = list(map(int, input().split()))
best = [1] * n
for i in range(n):
    for j in range(i):
        if a[j] < a[i]: best[i] = max(best[i], best[j] + 1)
print(max(best))
