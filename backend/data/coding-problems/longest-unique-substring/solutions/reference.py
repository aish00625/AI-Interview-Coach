s = input().strip()
last = {}
left = best = 0
for right, c in enumerate(s):
    if c in last and last[c] >= left:
        left = last[c] + 1
    last[c] = right
    best = max(best, right - left + 1)
print(best)
