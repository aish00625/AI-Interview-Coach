n, l, r = map(int, input().split()); vals = input().split()
print(' '.join(vals[:l - 1] + vals[l - 1:r][::-1] + vals[r:]))
