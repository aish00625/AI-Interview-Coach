import sys
d = sys.stdin.read().split(); n, m = int(d[0]), int(d[1])
a = list(map(int, d[2:2 + n])); b = list(map(int, d[2 + n:2 + n + m]))
print(' '.join(map(str, sorted(a + b))))
