const s = require('fs').readFileSync(0, 'utf8').split('\n')[0];
const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');
console.log(t === t.split('').reverse().join('') ? 'YES' : 'NO');
