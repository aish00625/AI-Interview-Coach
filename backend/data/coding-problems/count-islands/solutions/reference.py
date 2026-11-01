import sys
from collections import deque
data = sys.stdin.read().split()
R, C = int(data[0]), int(data[1]); g = [list(row) for row in data[2:2 + R]]
count = 0
for i in range(R):
    for j in range(C):
        if g[i][j] == '1':
            count += 1
            g[i][j] = '0'
            q = deque([(i, j)])
            while q:
                x, y = q.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    a, b = x + dx, y + dy
                    if 0 <= a < R and 0 <= b < C and g[a][b] == '1':
                        g[a][b] = '0'; q.append((a, b))
print(count)
