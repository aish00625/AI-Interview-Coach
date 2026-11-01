const s = require('fs').readFileSync(0, 'utf8').split('\n')[0].trim();
const match = { ')': '(', ']': '[', '}': '{' };
const stack = []; let ok = true;
for (const c of s) {
  if ('([{'.includes(c)) stack.push(c);
  else if (!stack.length || stack.pop() !== match[c]) { ok = false; break; }
}
console.log(ok && stack.length === 0 ? 'YES' : 'NO');
