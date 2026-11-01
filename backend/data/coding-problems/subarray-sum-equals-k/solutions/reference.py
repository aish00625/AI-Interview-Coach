n, k = map(int, input().split()); a = list(map(int, input().split()))
seen = {0: 1}; s = 0; ans = 0
for v in a:
    s += v
    ans += seen.get(s - k, 0)
    seen[s] = seen.get(s, 0) + 1
print(ans)
