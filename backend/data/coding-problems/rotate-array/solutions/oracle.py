n, k = map(int, input().split())
a = input().split()
for _ in range(k % n):
    a.insert(0, a.pop())
print(' '.join(a))
