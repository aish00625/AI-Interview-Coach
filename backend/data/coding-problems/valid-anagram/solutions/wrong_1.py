s = input().strip(); t = input().strip()
print('YES' if set(s) == set(t) else 'NO')  # BUG: ignores how many times each letter appears
