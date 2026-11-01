from collections import deque
s = input().strip(); cnt = [0] * 26; q = deque(); out = []
for c in s:
    cnt[ord(c) - 97] += 1
    q.append(c)
    while q and cnt[ord(q[0]) - 97] > 1: q.popleft()
    out.append(q[0] if q else '#')
print(''.join(out))
