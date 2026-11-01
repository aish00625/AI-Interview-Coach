import sys
s = sys.stdin.readline()
t = [c.lower() for c in s if c.isalnum() and c.isascii()]
print('YES' if t == t[::-1] else 'NO')
