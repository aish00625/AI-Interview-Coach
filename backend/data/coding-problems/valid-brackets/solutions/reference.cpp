#include <bits/stdc++.h>
using namespace std;
int main() {
    string s; getline(cin, s);
    string st; bool ok = true;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') { st.push_back(c); continue; }
        if (c != ')' && c != ']' && c != '}') continue;
        if (st.empty()) { ok = false; break; }
        char o = st.back(); st.pop_back();
        if ((c == ')' && o != '(') || (c == ']' && o != '[') || (c == '}' && o != '{')) { ok = false; break; }
    }
    cout << (ok && st.empty() ? "YES" : "NO") << endl;
}
