from collections import deque
tok = input().split()
class N:
    def __init__(self, v): self.v = int(v); self.l = None; self.r = None
def build(tok):
    if not tok or tok[0] == 'null': return None
    root = N(tok[0]); q = deque([root]); i = 1
    while q and i < len(tok):
        node = q.popleft()
        if i < len(tok) and tok[i] != 'null': node.l = N(tok[i]); q.append(node.l)
        i += 1
        if i < len(tok) and tok[i] != 'null': node.r = N(tok[i]); q.append(node.r)
        i += 1
    return root
root = build(tok)

def ok(n, lo, hi):
    if n is None: return True
    if (lo is not None and n.v <= lo) or (hi is not None and n.v >= hi): return False
    return ok(n.l, lo, n.v) and ok(n.r, n.v, hi)
print('YES' if ok(root, None, None) else 'NO')
