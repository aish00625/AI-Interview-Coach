import heapq
n, k = map(int, input().split()); a = list(map(int, input().split()))
h = []
for v in a:
    heapq.heappush(h, v)
    if len(h) > k: heapq.heappop(h)
print(h[0])
