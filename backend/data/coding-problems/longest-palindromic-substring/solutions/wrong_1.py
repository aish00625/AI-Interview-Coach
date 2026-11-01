s = input().strip(); n = len(s); best = 1
for i in range(n):
    l = r = i
    while l >= 0 and r < n and s[l] == s[r]:
        l -= 1; r += 1
    best = max(best, r - l - 1)  # BUG: only odd-length centres
print(best)
