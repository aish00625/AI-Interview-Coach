import sys
data = sys.stdin.read().split(); n, m = int(data[0]), int(data[1])
pairs = set()
for i in range(m):
    pairs.add((int(data[2 + 2 * i]), int(data[3 + 2 * i])))
print('NO' if any((b, a) in pairs for a, b in pairs) else 'YES')  # BUG: only detects two-course cycles
