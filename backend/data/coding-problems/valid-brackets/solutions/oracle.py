s = input().strip()
prev = None
while prev != s:
    prev = s
    s = s.replace('()', '').replace('[]', '').replace('{}', '')
print('YES' if s == '' else 'NO')
