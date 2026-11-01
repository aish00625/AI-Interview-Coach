const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const t = L[1].trim().split(/\s+/).map(Number);
const ans = new Array(n).fill(0); const st = [];
for (let i = 0; i < n; i++) { while (st.length && t[st[st.length - 1]] < t[i]) { const j = st.pop(); ans[j] = i - j; } st.push(i); }
console.log(ans.join(' '));
