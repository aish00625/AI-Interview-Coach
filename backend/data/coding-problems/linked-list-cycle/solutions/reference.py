n, pos = map(int, input().split()); vals = input().split()
nxt = [i + 1 for i in range(n)]
nxt[n - 1] = pos if pos >= 0 else -1
slow = fast = 0; cyc = False
while fast != -1 and nxt[fast] != -1:
    slow = nxt[slow]; fast = nxt[nxt[fast]]
    if slow == fast: cyc = True; break
print('YES' if cyc else 'NO')
