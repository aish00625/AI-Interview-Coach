const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean);
const R = +t[0], C = +t[1]; const g = t.slice(2, 2 + R).map((r) => r.split(''));
let count = 0;
for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
  if (g[i][j] !== '1') continue;
  count++; g[i][j] = '0'; const st = [[i, j]];
  while (st.length) {
    const [x, y] = st.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = y + dy;
      if (a >= 0 && a < R && b >= 0 && b < C && g[a][b] === '1') { g[a][b] = '0'; st.push([a, b]); }
    }
  }
}
console.log(String(count));
