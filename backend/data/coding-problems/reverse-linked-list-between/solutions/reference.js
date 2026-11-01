const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, l, r] = L[0].trim().split(/\s+/).map(Number); const v = L[1].trim().split(/\s+/);
const mid = v.slice(l - 1, r).reverse(); console.log(v.slice(0, l - 1).concat(mid, v.slice(r)).join(' '));
