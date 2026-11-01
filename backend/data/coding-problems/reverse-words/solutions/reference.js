const line = require('fs').readFileSync(0, 'utf8').split('\n')[0];
console.log(line.split(/\s+/).filter(Boolean).reverse().join(' '));
