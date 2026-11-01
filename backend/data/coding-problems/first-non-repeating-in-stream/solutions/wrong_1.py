from collections import deque
s = input().strip(); cnt = [0] * 26; q = deque(); out = []
for c in s:
    cnt[ord(c) - 97] += 1
    q.append(c)
    out.append(q[0] if cnt[ord(q[0]) - 97] == 1 else '#')  # BUG: does not discard repeated characters from the front
print(''.join(out))
