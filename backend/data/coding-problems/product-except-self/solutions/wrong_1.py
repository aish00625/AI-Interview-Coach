n = int(input()); a = list(map(int, input().split()))
t = 1
for v in a: t *= v
print(' '.join(str(t // v if v else 0) for v in a))  # BUG: wrong when the array contains zeros
