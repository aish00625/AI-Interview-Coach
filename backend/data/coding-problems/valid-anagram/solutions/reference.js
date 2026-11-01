const L = require('fs').readFileSync(0, 'utf8').split('\n');
const s = L[0].trim(), t = L[1].trim();
console.log([...s].sort().join('') === [...t].sort().join('') ? 'YES' : 'NO');
