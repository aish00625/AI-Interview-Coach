n, k = map(int, input().split())
a = input().split()
k %= n
print(' '.join(a[n - k:] + a[:n - k]) if k else ' '.join(a))
