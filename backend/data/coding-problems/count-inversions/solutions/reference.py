import sys
def count(a):
    n = len(a)
    if n <= 1: return a, 0
    left, x = count(a[:n // 2]); right, y = count(a[n // 2:])
    merged = []; i = j = 0; inv = x + y
    while i < len(left) and j < len(right):
        if left[i] <= right[j]: merged.append(left[i]); i += 1
        else: merged.append(right[j]); j += 1; inv += len(left) - i
    merged += left[i:] + right[j:]
    return merged, inv
n = int(input()); a = list(map(int, input().split()))
print(count(a)[1])
