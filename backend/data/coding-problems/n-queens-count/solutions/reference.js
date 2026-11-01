const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); let count = 0;
(function go(row, cols, d1, d2) { if (row === n) { count++; return; }
  for (let c = 0; c < n; c++) { const a = 1 << c, b = 1 << (row - c + n), d = 1 << (row + c); if ((cols & a) || (d1 & b) || (d2 & d)) continue; go(row + 1, cols | a, d1 | b, d2 | d); } })(0, 0, 0, 0);
console.log(String(count));
