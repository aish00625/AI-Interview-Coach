const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, k0] = L[0].trim().split(/\s+/).map(Number);
const a = L[1].trim().split(/\s+/);
const k = k0 % n;
console.log(k ? a.slice(n - k).concat(a.slice(0, n - k)).join(' ') : a.join(' '));
