const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, k] = L[0].trim().split(/\s+/).map(Number); const v = L[1].trim().split(/\s+/);
v.splice(n - k, 1); console.log(v.length ? v.join(' ') : 'EMPTY');
