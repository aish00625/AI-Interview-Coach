tokens = input().split(); st = []
for t in tokens:
    if t in '+-*/' and len(t) == 1:
        b = st.pop(); a = st.pop()
        st.append({'+': a + b, '-': a - b, '*': a * b, '/': a // b if t == '/' else 0}[t])  # BUG: floor division
    else: st.append(int(t))
print(st[0])
