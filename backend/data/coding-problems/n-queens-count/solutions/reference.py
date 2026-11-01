n = int(input()); count = 0
def go(row, cols, d1, d2):
    global count
    if row == n: count += 1; return
    for c in range(n):
        if c in cols or (row - c) in d1 or (row + c) in d2: continue
        cols.add(c); d1.add(row - c); d2.add(row + c)
        go(row + 1, cols, d1, d2)
        cols.discard(c); d1.discard(row - c); d2.discard(row + c)
go(0, set(), set(), set())
print(count)
