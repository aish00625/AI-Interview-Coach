n = int(input()); a = set(map(int, input().split()))
for x in range(n + 1):
    if x not in a:
        print(x); break
