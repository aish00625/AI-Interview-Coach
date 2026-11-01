import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1 + n])); x = int(d[1 + n])
print(next((i for i, v in enumerate(a) if v == x), -1))
