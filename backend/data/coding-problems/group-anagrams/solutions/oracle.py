n = int(input()); words = [input().strip() for _ in range(n)]
used = [False] * n; rows = []
for i in range(n):
    if used[i]: continue
    g = [words[i]]; used[i] = True
    for j in range(i + 1, n):
        if not used[j] and sorted(words[j]) == sorted(words[i]):
            g.append(words[j]); used[j] = True
    rows.append(sorted(g))
rows.sort(key=lambda g: g[0])
print('\n'.join(' '.join(g) for g in rows))
