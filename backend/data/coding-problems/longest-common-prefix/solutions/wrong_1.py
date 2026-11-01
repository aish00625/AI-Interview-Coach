n = int(input()); words = [input().strip() for _ in range(n)]
a, b = words[0], words[-1] if n == 1 else words[1]
i = 0
while i < min(len(a), len(b)) and a[i] == b[i]: i += 1
print(a[:i] if i else 'NONE')  # BUG: only compares the first two words
