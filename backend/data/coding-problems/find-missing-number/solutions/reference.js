const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); const a = L[1].trim().split(/\s+/).map(Number);
console.log(String(n * (n + 1) / 2 - a.reduce((s, x) => s + x, 0)));
