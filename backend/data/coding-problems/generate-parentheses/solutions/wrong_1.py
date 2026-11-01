n = int(input()); out = []
def go(s, o, c):
    if len(s) == 2 * n: out.append(s); return
    if c < o: go(s + ')', o, c + 1)  # BUG: tries ")" first, so the output is not in dictionary order
    if o < n: go(s + '(', o + 1, c)
go('', 0, 0)
print('\n'.join(out))
