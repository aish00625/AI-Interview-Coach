n = int(input())
def solve(placed):
    r = len(placed)
    if r == n: return 1
    total = 0
    for c in range(n):
        if all(c != pc and abs(c - pc) != r - pr for pr, pc in enumerate(placed)):
            total += solve(placed + [c])
    return total
print(solve([]))
