tokens = input().split()
pos = [len(tokens) - 1]
def parse():
    t = tokens[pos[0]]; pos[0] -= 1
    if len(t) == 1 and t in '+-*/':
        b = parse(); a = parse()
        if t == '+': return a + b
        if t == '-': return a - b
        if t == '*': return a * b
        return int(a / b)
    return int(t)
print(parse())
