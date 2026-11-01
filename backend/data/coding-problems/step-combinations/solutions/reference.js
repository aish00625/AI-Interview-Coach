const [n, k] = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/).map(Number);
const MOD = 1000000007n;
const ways = new Array(n + 1).fill(0n); ways[0] = 1n;
let window = 1n;
for (let i = 1; i <= n; i++) {
  ways[i] = window % MOD;
  window = (window + ways[i]) % MOD;
  if (i - k >= 0) window = ((window - ways[i - k]) % MOD + MOD) % MOD;
}
console.log(String(ways[n] % MOD));
