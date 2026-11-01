n = int(input()); groups = {}
for _ in range(n):
    w = input().strip()
    groups.setdefault(''.join(sorted(w)), []).append(w)
rows = [sorted(g) for g in groups.values()]
rows.sort(key=lambda g: g[0])
print('\n'.join(' '.join(g) for g in rows))
