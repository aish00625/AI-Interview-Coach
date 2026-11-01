import sys
d = sys.stdin.read().split(); n, m = int(d[0]), int(d[1])
a = list(map(int, d[2:2 + n])); b = list(map(int, d[2 + n:2 + n + m]))
i = j = 0; out = []
while i < n and j < m:
    if a[i] <= b[j]: out.append(a[i]); i += 1
    else: out.append(b[j]); j += 1
out.extend(a[i:]); out.extend(b[j:])
print(' '.join(map(str, out)))
