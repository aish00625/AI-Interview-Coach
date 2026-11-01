n = int(input()); h = list(map(int, input().split()))
total = 0
for i in range(n):
    left = max(h[:i + 1]); right = max(h[i:])
    total += min(left, right) - h[i]
print(total)
