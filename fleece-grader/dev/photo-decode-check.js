// Dev-only driver for the shared photo decoder (omr.js decodeImage). Load it from the app page under the dev server, one scenario per call
// (each cdp-shot call is a fresh profile). See photo-decode-check.sh for the batch:
//   node .claude/tools/cdp-shot.mjs http://localhost:PORT/index.html 390 - --eval "import('/dev/photo-decode-check.js').then(m => m.sheet('sheet02', { stub: true }))"
// sheet(name, opts): add a real student sheet through the Scan input (#f-up) and return its saved answers as JSON.
// key(name, opts): scan an official-key photo through #f-key and return the saved key as JSON.
// opts.stub: createImageBitmap rejects. opts.noimg: <img> decodes fail, so only createImageBitmap can open the photo.
// opts.big: 'WxH' upscales the sheet into a JPEG of that size first. opts.file: read this fixture instead (make-big-photo.py writes the 8064x6048 EXIF-rotated one).
// bad(): a file that is not an image; the sheet must say plainly that the photo could not be opened.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => JSON.parse(localStorage.getItem('fleece-grader-v1'));
async function until(fn, ms = 180000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(150); } return false; }
const busyDone = () => document.getElementById('busy').hidden;

function patch(o = {}) {
  if (o.stub) window.createImageBitmap = () => Promise.reject(new Error('stubbed'));
  if (o.noimg) {
    const Orig = window.Image;
    window.Image = function () { const i = new Orig(); Object.defineProperty(i, 'src', { set() { setTimeout(() => i.dispatchEvent(new Event('error')), 0); } }); return i; };
  }
}
async function fetchBlob(path) { const r = await fetch(path); if (!r.ok) throw new Error(path + ' ' + r.status); return r.blob(); }
async function upscale(blob, size) {
  const [W, H] = size.split('x').map(Number), url = URL.createObjectURL(blob);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, W, H);
  URL.revokeObjectURL(url);
  const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  return out;
}
async function feed(id, file) {
  const input = document.getElementById(id), dt = new DataTransfer();
  dt.items.add(file); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(400); await until(busyDone);
}
const answers = () => JSON.stringify(store().sheets.map((s) => s.saved.answers));
const status = () => { const e = document.querySelector('.s-st'); return e ? e.textContent.trim() : null; };

export async function sheet(name, o = {}) {
  patch(o);
  let blob = await fetchBlob(o.file || '/assets/test/real/' + name + '.jpg'), dims = null;
  if (o.big) { blob = await upscale(blob, o.big); dims = o.big; }
  await feed('f-up', new File([blob], name + '.jpg', { type: 'image/jpeg' }));
  const a = store().sheets.length ? answers() : null;
  return { name, dims, bytes: blob.size, sheets: store().sheets.length, status: status(), hash: a && a.length + ':' + [...a].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7) };
}
export async function key(name, o = {}) {
  patch(o);
  const blob = await fetchBlob('/assets/test/keys/' + encodeURIComponent(name));
  await feed('f-key', new File([blob], name, { type: 'image/jpeg' }));
  const d = store(), k = JSON.stringify(d.key);
  return { name, filled: d.key.filter((r) => r.grade != null || r.yield != null).length, notice: document.getElementById('key-notice').textContent.slice(0, 60), toast: (document.getElementById('toast') || {}).textContent, hash: k.length + ':' + [...k].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7) };
}
export async function bad(o = {}) {
  patch({ stub: true, noimg: true, ...o });
  await feed('f-up', new File(['not an image'], 'broken.jpg', { type: 'image/jpeg' }));
  return { status: status() };
}
