const L = require('fs').readFileSync(0, 'utf8').split('\n');
const a = L[1].trim().split(/\s+/).map(Number); let take = 0, skip = 0;
for (const v of a) { const nt = skip + v; skip = Math.max(take, skip); take = nt; }
console.log(String(Math.max(take, skip)));
