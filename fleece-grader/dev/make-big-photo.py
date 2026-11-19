"""Make an iPhone-48MP-style test photo from a real sheet: python fleece-grader/dev/make-big-photo.py [sheet02]
Writes assets/test/excluded/big-<sheet>.jpg: 8064x6048 stored pixels with EXIF Orientation 6 (what a portrait 48MP shot is),
so a browser shows it as a 6048x8064 portrait. Private folder, gitignored."""
import sys, pathlib
from PIL import Image
name = sys.argv[1] if len(sys.argv) > 1 else "sheet02"
root = pathlib.Path(__file__).resolve().parent.parent / "assets" / "test"
img = Image.open(root / "real" / f"{name}.jpg").convert("RGB").resize((6048, 8064), Image.LANCZOS)
stored = img.rotate(90, expand=True)  # display = stored turned 90 CW, as Orientation 6 says
exif = Image.Exif(); exif[0x0112] = 6
out = root / "excluded" / f"big-{name}.jpg"; out.parent.mkdir(exist_ok=True)
stored.save(out, "JPEG", quality=88, exif=exif)
print(out, stored.size, out.stat().st_size)
