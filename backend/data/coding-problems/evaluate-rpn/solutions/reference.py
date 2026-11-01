tokens = input().split(); st = []
for t in tokens:
    if t in '+-*/' and len(t) == 1:
        b = st.pop(); a = st.pop()
        if t == '+': st.append(a + b)
        elif t == '-': st.append(a - b)
        elif t == '*': st.append(a * b)
        else:
            q = abs(a) // abs(b)
            st.append(q if (a < 0) == (b < 0) else -q)
    else: st.append(int(t))
print(st[0])
