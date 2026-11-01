import sys
def main():
    data = sys.stdin.read().split()
    n = int(data[0]); a = list(map(int, data[1:1 + n])); target = int(data[1 + n])
    seen = {}
    for i, x in enumerate(a):
        if target - x in seen:
            print(seen[target - x], i)
            return
        seen[x] = i
main()
