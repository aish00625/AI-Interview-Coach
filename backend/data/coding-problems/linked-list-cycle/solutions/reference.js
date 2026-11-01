const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, pos] = L[0].trim().split(/\s+/).map(Number);
const nxt = Array.from({ length: n }, (_, i) => i + 1); nxt[n - 1] = pos >= 0 ? pos : -1;
let s = 0, f = 0, cyc = false;
while (f !== -1 && nxt[f] !== -1) { s = nxt[s]; f = nxt[nxt[f]]; if (s === f) { cyc = true; break; } }
console.log(cyc ? 'YES' : 'NO');
