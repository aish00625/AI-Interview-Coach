import sys
data = sys.stdin.read().split()
R, C = int(data[0]), int(data[1]); g = data[2:2 + R]
parent = list(range(R * C))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
for i in range(R):
    for j in range(C):
        if g[i][j] == '1':
            for a, b in ((i + 1, j), (i, j + 1)):
                if a < R and b < C and g[a][b] == '1':
                    parent[find(i * C + j)] = find(a * C + b)
print(len({find(i * C + j) for i in range(R) for j in range(C) if g[i][j] == '1'}))
