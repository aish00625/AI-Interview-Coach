n, k = map(int, input().split()); vals = input().split()
del vals[n - k]
print(' '.join(vals) if vals else 'EMPTY')
