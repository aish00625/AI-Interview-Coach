const L = require('fs').readFileSync(0, 'utf8').split('\n');
const [n, W] = L[0].trim().split(/\s+/).map(Number); const dp = new Array(W + 1).fill(0);
for (let i = 1; i <= n; i++) { const [wt, val] = L[i].trim().split(/\s+/).map(Number); for (let w = W; w >= wt; w--) dp[w] = Math.max(dp[w], dp[w - wt] + val); }
console.log(String(dp[W]));
