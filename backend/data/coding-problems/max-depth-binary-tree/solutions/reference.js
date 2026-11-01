const L = require('fs').readFileSync(0, 'utf8').split('\n');

const tok = L[0].trim().split(/\s+/);
function build() {
  if (!tok.length || tok[0] === 'null') return null;
  const root = { v: +tok[0], l: null, r: null }; const q = [root]; let h = 0, i = 1;
  while (h < q.length && i < tok.length) {
    const n = q[h++];
    if (i < tok.length && tok[i] !== 'null') { n.l = { v: +tok[i], l: null, r: null }; q.push(n.l); } i++;
    if (i < tok.length && tok[i] !== 'null') { n.r = { v: +tok[i], l: null, r: null }; q.push(n.r); } i++;
  }
  return root;
}
const root = build();
let d = 0, level = root ? [root] : [];
while (level.length) { d++; const nx = []; for (const n of level) { if (n.l) nx.push(n.l); if (n.r) nx.push(n.r); } level = nx; }
console.log(String(d));
