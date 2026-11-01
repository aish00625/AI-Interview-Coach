line = input()
words, cur = [], ''
for ch in line + ' ':
    if ch == ' ':
        if cur: words.append(cur); cur = ''
    else:
        cur += ch
out = ''
for w in words:
    out = w + (' ' + out if out else '')
print(out)
