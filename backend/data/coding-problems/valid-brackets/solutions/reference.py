import sys
s = sys.stdin.readline().strip()
match = {')': '(', ']': '[', '}': '{'}
stack = []
ok = True
for c in s:
    if c in '([{':
        stack.append(c)
    else:
        if not stack or stack.pop() != match[c]:
            ok = False
            break
print('YES' if ok and not stack else 'NO')
