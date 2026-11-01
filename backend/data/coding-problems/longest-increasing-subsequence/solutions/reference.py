from bisect import bisect_left
n = int(input()); a = list(map(int, input().split())); tails = []
for v in a:
    i = bisect_left(tails, v)
    if i == len(tails): tails.append(v)
    else: tails[i] = v
print(len(tails))
