// Handwritten-list reader harness. Reads the private key photo with listkey.js and scores it against the known rows.
// ?img=<file in assets/test/keys> picks another photo (graded sheet: should NOT return 20 rows). ?viz=1 draws the found boxes.
// Prints LISTEVALDONE; numbers are in window.__list.
import { readListKey, LIST, GRADE_COUNTS } from '../listkey.js';
const out = document.getElementById('out'), q = new URLSearchParams(location.search);
const file = q.get('img') || 'Scan from 2026-11-18 12_13_16 PM.jpg', conf = q.get('conf') != null ? +q.get('conf') : LIST.confident;
const TRUTH = '50 St 66/62 S 54/54 S 61/58 S 59/64 S 54/50 S 59/64 S 54/54 S 60/70 F 55/50 S 61/70 S 56/54 S 62/56 C 58/50 S 61/58 S 58/70 S 56/64 S 53/54 C 65/70 S 56/46 S 64'
  .split('/').map(s => { const [g, l, y] = s.split(' '); return { grade: GRADE_COUNTS.indexOf(+g), length: { S: 0, St: 0, F: 1, C: 2 }[l], yield: +y }; });
const url = '../assets/test/keys/' + encodeURIComponent(file);
const res = await readListKey(url);
const sc = { grade: 0, length: 0, yield: 0, confidentN: 0, confidentWrong: 0 }, bad = [];
if (res.ok && file.startsWith('Scan from 2026-11-18 12_13')) {
  res.rows.forEach((r, i) => {
    const t = TRUTH[i]; if (!t) return;
    for (const f of ['grade', 'length', 'yield']) {
      const ok = r[f] === t[f], c = r.conf[f] >= conf; if (ok) sc[f]++; if (c) { sc.confidentN++; if (!ok) sc.confidentWrong++; }
      if (!ok) bad.push(`r${i + 1} ${f}: got ${r.text[f]} (${r.conf[f].toFixed(2)}) want ${f === 'grade' ? GRADE_COUNTS[t.grade] : f === 'length' ? 'SFC'[t.length] : t.yield}`);
    }
  });
}
window.__list = { res, sc, bad };
const summary = `LISTEVALDONE file=${file} ok=${res.ok} err=${res.error || ''} n=${res.n ?? (res.rows ? res.rows.length : 0)} grade=${sc.grade}/20 length=${sc.length}/20 yield=${sc.yield}/20 confidentWrong=${sc.confidentWrong}/${sc.confidentN} ms=${res.ms} warnings=${JSON.stringify(res.warnings)}`;
out.textContent = summary + '\n' + bad.join('\n');
if (q.get('viz')) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.getElementById('viz'), s = 0.5; c.hidden = false; c.width = img.naturalWidth * s; c.height = img.naturalHeight * s;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height); g.lineWidth = 2;
  for (const r of res.rows || []) for (const [k, col] of [['grade', 'red'], ['length', 'blue'], ['yield', 'green']]) { const b = r.rects[k]; if (b) { g.strokeStyle = col; g.strokeRect(b.x * s, b.y * s, b.w * s, b.h * s); } }
}
document.title = 'done'; document.body.insertAdjacentHTML('afterbegin', '<p>' + summary.replace(/[&<>"']/g, ch => '&#' + ch.charCodeAt(0) + ';') + '</p>');
