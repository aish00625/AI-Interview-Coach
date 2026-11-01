const L = require('fs').readFileSync(0, 'utf8').split('\n');
const t = L[0].trim().split(/\s+/); const st = [];
for (const x of t) {
  if (['+', '-', '*', '/'].includes(x)) { const b = st.pop(), a = st.pop();
    st.push(x === '+' ? a + b : x === '-' ? a - b : x === '*' ? a * b : Math.trunc(a / b)); }
  else st.push(parseInt(x, 10));
}
console.log(String(st[0]));
