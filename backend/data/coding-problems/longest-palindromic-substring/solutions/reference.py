s = input().strip(); n = len(s); best = 1
def expand(l, r):
    while l >= 0 and r < n and s[l] == s[r]:
        l -= 1; r += 1
    return r - l - 1
for i in range(n):
    best = max(best, expand(i, i), expand(i, i + 1))
print(best)
