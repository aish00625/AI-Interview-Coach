n = int(input()); words = [input().strip() for _ in range(n)]
best = ''
for L in range(1, min(map(len, words)) + 1):
    if all(w[:L] == words[0][:L] for w in words): best = words[0][:L]
    else: break
print(best if best else 'NONE')
