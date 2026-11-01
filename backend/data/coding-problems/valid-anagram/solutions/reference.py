s = input().strip(); t = input().strip()
cnt = [0] * 26
for c in s: cnt[ord(c) - 97] += 1
for c in t: cnt[ord(c) - 97] -= 1
print('YES' if len(s) == len(t) and not any(cnt) else 'NO')
