n = int(input()); words = [input().strip() for _ in range(n)]
prefix = words[0]
for w in words[1:]:
    while not w.startswith(prefix):
        prefix = prefix[:-1]
print(prefix if prefix else 'NONE')
