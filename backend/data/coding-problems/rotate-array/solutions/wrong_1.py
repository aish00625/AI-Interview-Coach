n, k = map(int, input().split())
a = input().split()
k %= n
print(' '.join(a[k:] + a[:k]))  # BUG: rotates left
