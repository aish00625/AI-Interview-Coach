s = input()
i, j = 0, len(s) - 1
ok = True
def alnum(c): return ('a' <= c <= 'z') or ('A' <= c <= 'Z') or ('0' <= c <= '9')
while i < j:
    if not alnum(s[i]): i += 1; continue
    if not alnum(s[j]): j -= 1; continue
    if s[i].lower() != s[j].lower(): ok = False; break
    i += 1; j -= 1
print('YES' if ok else 'NO')
