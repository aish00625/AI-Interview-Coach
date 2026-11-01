const L = require('fs').readFileSync(0, 'utf8').split('\n');
const n = parseInt(L[0]); let a = L[1].trim().split(/\s+/).map(Number); let inv = 0;
function sort(arr) {
  if (arr.length <= 1) return arr;
  const mid = arr.length >> 1; const l = sort(arr.slice(0, mid)), r = sort(arr.slice(mid)); const out = []; let i = 0, j = 0;
  while (i < l.length && j < r.length) { if (l[i] <= r[j]) out.push(l[i++]); else { out.push(r[j++]); inv += l.length - i; } }
  while (i < l.length) out.push(l[i++]); while (j < r.length) out.push(r[j++]); return out;
}
sort(a); console.log(String(inv));
