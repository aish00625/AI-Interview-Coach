n, t = map(int, input().split()); a = list(map(int, input().split()))
i = 0
while i < n and a[i] < t: i += 1
print(i)
