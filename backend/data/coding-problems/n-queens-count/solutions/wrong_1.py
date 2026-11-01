n = int(input()); count = 0
def go(row, cols, d1):
    global count
    if row == n: count += 1; return
    for c in range(n):
        if c in cols or (row - c) in d1: continue  # BUG: ignores the second diagonal direction
        cols.add(c); d1.add(row - c)
        go(row + 1, cols, d1)
        cols.discard(c); d1.discard(row - c)
go(0, set(), set())
print(count)
