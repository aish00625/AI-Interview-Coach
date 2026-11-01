s = input().strip(); n = len(s); best = 1
for i in range(n):
    for j in range(i, n):
        t = s[i:j + 1]
        if t == t[::-1]: best = max(best, j - i + 1)
print(best)
