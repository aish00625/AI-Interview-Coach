n, k = map(int, input().split()); a = list(map(int, input().split()))
print(' '.join(str(max(a[i:i + k])) for i in range(n - k + 1)))
