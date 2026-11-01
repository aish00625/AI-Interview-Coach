const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const n = t[0], amount = t[1]; const coins = t.slice(2, 2 + n);
const INF = 1e9; const best = new Array(amount + 1).fill(INF); best[0] = 0;
for (let a = 1; a <= amount; a++) for (const c of coins) if (c <= a && best[a - c] + 1 < best[a]) best[a] = best[a - c] + 1;
console.log(String(best[amount] >= INF ? -1 : best[amount]));
