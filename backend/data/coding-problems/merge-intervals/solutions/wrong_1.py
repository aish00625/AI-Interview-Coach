import sys
d = sys.stdin.read().split(); n = int(d[0])
iv = sorted((int(d[1 + 2 * i]), int(d[2 + 2 * i])) for i in range(n))
out = []; cl, cr = iv[0]
for l, r in iv[1:]:
    if l < cr: cr = max(cr, r)           # BUG: strict comparison, touching intervals are not merged
    else: out.append((cl, cr)); cl, cr = l, r
out.append((cl, cr))
print('\n'.join(f"{a} {b}" for a, b in out))
