from collections import deque
n, k = map(int, input().split()); a = list(map(int, input().split()))
dq = deque(); out = []
for i, v in enumerate(a):
    while dq and a[dq[-1]] <= v: dq.pop()
    dq.append(i)
    if dq[0] <= i - k: dq.popleft()
    if i >= k - 1: out.append(a[dq[0]])
print(' '.join(map(str, out)))
