import sys
data = sys.stdin.read().split()
R, C = int(data[0]), int(data[1]); g = [list(r) for r in data[2:2 + R]]
count = 0
for i in range(R):
    for j in range(C):
        if g[i][j] == '1':
            count += 1; g[i][j] = '0'; st = [(i, j)]
            while st:
                x, y = st.pop()
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):          # BUG: includes diagonal neighbours
                        a, b = x + dx, y + dy
                        if 0 <= a < R and 0 <= b < C and g[a][b] == '1':
                            g[a][b] = '0'; st.append((a, b))
print(count)
