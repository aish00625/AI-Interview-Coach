n, pos = map(int, input().split()); vals = input().split()
print('YES' if len(set(vals)) < n else 'NO')  # BUG: treats repeated values as a cycle
