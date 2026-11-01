n = int(input()); t = list(map(int, input().split()))
ans = [0] * n; st = []
for i, v in enumerate(t):
    while st and t[st[-1]] <= v:  # BUG: equal temperatures are not warmer
        j = st.pop(); ans[j] = i - j
    st.append(i)
print(' '.join(map(str, ans)))
