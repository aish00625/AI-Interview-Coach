n = int(input()); groups = {}
for _ in range(n):
    w = input().strip()
    groups.setdefault(''.join(sorted(w)), []).append(w)
rows = list(groups.values())  # BUG: groups and words are not sorted
print('\n'.join(' '.join(g) for g in rows))
