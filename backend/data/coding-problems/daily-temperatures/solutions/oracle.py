n = int(input()); t = list(map(int, input().split()))
ans = []
for i in range(n):
    d = 0
    for j in range(i + 1, n):
        if t[j] > t[i]: d = j - i; break
    ans.append(d)
print(' '.join(map(str, ans)))
