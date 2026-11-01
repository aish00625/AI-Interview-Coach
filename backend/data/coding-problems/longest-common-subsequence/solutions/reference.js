const L = require('fs').readFileSync(0, 'utf8').split('\n');
const s = L[0].trim(), t = L[1].trim(); const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));
for (let i = 1; i <= s.length; i++) for (let j = 1; j <= t.length; j++) dp[i][j] = s[i - 1] === t[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
console.log(String(dp[s.length][t.length]));
