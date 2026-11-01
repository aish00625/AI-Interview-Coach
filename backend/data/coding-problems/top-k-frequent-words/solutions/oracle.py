n, k = map(int, input().split()); words = input().split()
distinct = sorted(set(words)); chosen = []
for _ in range(k):
    best = None
    for w in distinct:
        if w in chosen: continue
        c = words.count(w)
        if best is None or c > words.count(best): best = w
    chosen.append(best)
print('\n'.join(chosen))
