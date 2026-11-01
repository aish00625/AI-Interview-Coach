s = input().strip()
print(len(set(s)))      # BUG: counts distinct letters in the whole string, not in one substring
