# One-off: assembled omr.js v2 from the kept parts of omr-v1.js plus new code in v2_parts/. Kept for reference only.
import pathlib
here = pathlib.Path(__file__).resolve().parent
root = here.parent.parent
old = (here / 'omr-v1.js').read_text(encoding='utf-8')


def cut(a, b):
    i = old.index(a)
    j = old.index(b, i)
    return old[i:j]


part = lambda n: (here / 'v2_parts' / n).read_text(encoding='utf-8')
out = (part('head.js') + cut("let cvPromise = null;", "async function toCanvas(src)") + part('tocanvas.js')
       + cut("function dist(a, b)", "function mat3ToArray(m)") + part('warp.js')
       + cut("// ---------- analysis maps on the warped canvas ----------", "// ---------- horizontal row separators ----------")
       + part('fill.js') + cut("// ---- grader slash: colour mode ----", "// ---------- main ----------") + part('main.js'))
(root / 'omr.js').write_text(out, encoding='utf-8')
print('omr.js written', len(out))
