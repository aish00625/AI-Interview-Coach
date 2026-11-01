s = input()
print('YES' if s == s[::-1] else 'NO')   # BUG: does not ignore case or punctuation
