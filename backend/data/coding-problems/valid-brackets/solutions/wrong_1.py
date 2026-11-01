s = input().strip()
print('YES' if s.count('(') == s.count(')') and s.count('[') == s.count(']') and s.count('{') == s.count('}') else 'NO')  # BUG: ignores order
