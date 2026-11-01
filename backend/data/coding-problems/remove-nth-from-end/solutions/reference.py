n, k = map(int, input().split()); vals = input().split()
class Node:
    def __init__(self, v): self.v = v; self.next = None
dummy = Node(None); cur = dummy
for v in vals:
    cur.next = Node(v); cur = cur.next
fast = slow = dummy
for _ in range(k): fast = fast.next
while fast.next: fast = fast.next; slow = slow.next
slow.next = slow.next.next
out = []; cur = dummy.next
while cur: out.append(cur.v); cur = cur.next
print(' '.join(out) if out else 'EMPTY')
