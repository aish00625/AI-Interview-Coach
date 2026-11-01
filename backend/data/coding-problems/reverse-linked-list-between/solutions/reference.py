n, l, r = map(int, input().split()); vals = input().split()
class Node:
    def __init__(self, v): self.v = v; self.next = None
dummy = Node(None); cur = dummy
for v in vals:
    cur.next = Node(v); cur = cur.next
before = dummy
for _ in range(l - 1): before = before.next
start = before.next
for _ in range(r - l):
    moving = start.next
    start.next = moving.next
    moving.next = before.next
    before.next = moving
out = []; cur = dummy.next
while cur: out.append(cur.v); cur = cur.next
print(' '.join(out))
