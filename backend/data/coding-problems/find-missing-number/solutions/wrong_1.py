n = int(input()); a = list(map(int, input().split()))
print(n * (n + 1) // 2 - sum(a) if 0 in a else n)  # BUG: wrong whenever 0 itself is the missing number
