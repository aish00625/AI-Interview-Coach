from bisect import bisect_right
n = int(input()); a = list(map(int, input().split())); tails = []
for v in a:
    i = bisect_right(tails, v)  # BUG: this finds the longest NON-decreasing subsequence
    if i == len(tails): tails.append(v)
    else: tails[i] = v
print(len(tails))
