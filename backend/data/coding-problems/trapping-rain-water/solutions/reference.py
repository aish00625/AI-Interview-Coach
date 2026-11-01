n = int(input()); h = list(map(int, input().split()))
l, r = 0, n - 1; lm = rm = 0; water = 0
while l < r:
    if h[l] < h[r]:
        lm = max(lm, h[l]); water += lm - h[l]; l += 1
    else:
        rm = max(rm, h[r]); water += rm - h[r]; r -= 1
print(water)
