const t = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const n = t[0]; const iv = [];
for (let i = 0; i < n; i++) iv.push([t[1 + 2 * i], t[2 + 2 * i]]);
iv.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const out = []; let [cl, cr] = iv[0];
for (let i = 1; i < n; i++) {
  const [l, r] = iv[i];
  if (l <= cr) cr = Math.max(cr, r); else { out.push(cl + ' ' + cr); cl = l; cr = r; }
}
out.push(cl + ' ' + cr);
console.log(out.join('\n'));
