const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, k] = L[0].trim().split(/\s+/).map(Number); const words = L[1].trim().split(/\s+/); const c = new Map();
for (const w of words) c.set(w, (c.get(w) || 0) + 1);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const order = [...c.keys()].sort((a, b) => c.get(b) - c.get(a) || cmp(a, b));
console.log(order.slice(0, k).join('\n'));
