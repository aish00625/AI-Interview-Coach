n, k = map(int, input().split()); a = list(map(int, input().split()))
print(sorted(set(a), reverse=True)[k - 1] if k <= len(set(a)) else min(a))  # BUG: removes duplicates
