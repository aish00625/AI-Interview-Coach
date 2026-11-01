n, l, r = map(int, input().split()); vals = input().split()
print(' '.join(vals[:l - 1] + vals[l - 1:r - 1][::-1] + vals[r - 1:]))  # BUG: reverses l..r-1
