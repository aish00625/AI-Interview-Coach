from itertools import product
n = int(input()); out = []
for t in product('()', repeat=2 * n):
    bal = 0; ok = True
    for ch in t:
        bal += 1 if ch == '(' else -1
        if bal < 0: ok = False; break
    if ok and bal == 0: out.append(''.join(t))
print('\n'.join(sorted(out)))
