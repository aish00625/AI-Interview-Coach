const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, k] = L[0].trim().split(/\s+/).map(Number); const a = L[1].trim().split(/\s+/).map(Number);
a.sort((x, y) => y - x);
console.log(String(a[k - 1]));
