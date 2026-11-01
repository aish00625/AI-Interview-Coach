import sys
sys.setrecursionlimit(100000)
data = sys.stdin.read().split(); n, m = int(data[0]), int(data[1])
adj = [[] for _ in range(n)]
for i in range(m):
    a, b = int(data[2 + 2 * i]), int(data[3 + 2 * i]); adj[a].append(b)
state = [0] * n
def cyc(u):
    state[u] = 1
    for v in adj[u]:
        if state[v] == 1 or (state[v] == 0 and cyc(v)): return True
    state[u] = 2; return False
print('NO' if any(state[i] == 0 and cyc(i) for i in range(n)) else 'YES')
