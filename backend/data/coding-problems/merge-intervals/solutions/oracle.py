import sys
d = sys.stdin.read().split(); n = int(d[0])
iv = [[int(d[1 + 2 * i]), int(d[2 + 2 * i])] for i in range(n)]
changed = True
while changed:
    changed = False
    for i in range(len(iv)):
        for j in range(i + 1, len(iv)):
            if iv[i][0] <= iv[j][1] and iv[j][0] <= iv[i][1]:
                iv[i] = [min(iv[i][0], iv[j][0]), max(iv[i][1], iv[j][1])]
                del iv[j]; changed = True; break
        if changed: break
iv.sort()
print('\n'.join(f"{a} {b}" for a, b in iv))
