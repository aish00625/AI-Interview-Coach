n, pos = map(int, input().split()); vals = input().split()
cur = 0; seen = set(); result = 'NO'
while True:
    if cur in seen: result = 'YES'; break
    seen.add(cur)
    if cur == n - 1:
        if pos >= 0: cur = pos
        else: break
    else: cur += 1
print(result)
