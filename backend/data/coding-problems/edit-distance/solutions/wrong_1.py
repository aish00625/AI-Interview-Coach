import sys
a = sys.stdin.readline().strip(); b = sys.stdin.readline().strip()
print(sum(1 for x, y in zip(a, b) if x != y) + abs(len(a) - len(b)))   # BUG: position-by-position comparison, never shifts characters
