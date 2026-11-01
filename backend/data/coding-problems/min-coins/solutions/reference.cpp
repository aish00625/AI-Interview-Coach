#include <bits/stdc++.h>
using namespace std;
int main() {
    int n, amount; cin >> n >> amount;
    vector<int> coins(n);
    for (auto &c : coins) cin >> c;
    const int INF = 1e9;
    vector<int> best(amount + 1, INF); best[0] = 0;
    for (int a = 1; a <= amount; a++)
        for (int c : coins)
            if (c <= a && best[a - c] + 1 < best[a]) best[a] = best[a - c] + 1;
    cout << (best[amount] >= INF ? -1 : best[amount]) << endl;
}
