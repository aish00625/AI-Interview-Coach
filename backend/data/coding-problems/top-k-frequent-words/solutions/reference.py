n, k = map(int, input().split()); words = input().split()
cnt = {}
for w in words: cnt[w] = cnt.get(w, 0) + 1
order = sorted(cnt, key=lambda w: (-cnt[w], w))
print('\n'.join(order[:k]))
