async function toCanvas(src) {
  if (typeof src === 'string') {
    src = await new Promise((res, rej) => { const i = new Image(); i.addEventListener('load', () => res(i)); i.addEventListener('error', () => rej(new Error('image load failed'))); i.src = src; });
  } else if (typeof Blob !== 'undefined' && src instanceof Blob) {
    src = await createImageBitmap(src, { imageOrientation: 'from-image' });
  }
  const w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
  const k = Math.min(1, MAX_SRC_EDGE / Math.max(w, h)); // a 12MP photo is more than the reader can use
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

