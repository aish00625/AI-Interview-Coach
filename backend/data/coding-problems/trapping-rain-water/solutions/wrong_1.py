n = int(input()); h = list(map(int, input().split()))
total = 0; left = 0
for v in h:
    left = max(left, v)
    total += left - v  # BUG: ignores the right wall
print(total)
