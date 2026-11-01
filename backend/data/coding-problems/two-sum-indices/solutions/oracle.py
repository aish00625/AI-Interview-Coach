import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1 + n])); t = int(d[1 + n])
found = [(i, j) for i in range(n) for j in range(i + 1, n) if a[i] + a[j] == t]
assert len(found) == 1, found
print(found[0][0], found[0][1])
