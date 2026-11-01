n, k = map(int, input().split()); vals = input().split()
del vals[k - 1]  # BUG: counts from the start instead of the end
print(' '.join(vals) if vals else 'EMPTY')
