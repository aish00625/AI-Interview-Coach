s = input().strip(); out = []
for i in range(1, len(s) + 1):
    p = s[:i]; ans = '#'
    for c in p:
        if p.count(c) == 1: ans = c; break
    out.append(ans)
print(''.join(out))
