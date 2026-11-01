n = int(input()); a = list(map(int, input().split()))
print(max(sum(a[0::2]), sum(a[1::2])))  # BUG: greedy on parity; sometimes two houses in a row must be skipped
