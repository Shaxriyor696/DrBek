"""iMedu rasmlarini ilova uchun tayyorlash.

    python tools/prepare_figures.py research/figures/01-rasmlar [boshqa papka ...]
    python tools/prepare_figures.py --map mapping.tsv     # har qatorda: <manba fayl> <TAB> r-chNN-MM

Har bir r-chNN-MM.(png|webp|jpg) uchun:
  * chetlaridagi bo'sh oq joy kesib olinadi, chekkadagi kulrang ramka chiziqlari öçiriladi;
  * kattalashtirilmaydi; eng uzun tomoni MAX_SIDE dan oshsa kichraytiriladi;
  * content/figures/img/ ga WebP qilib yoziladi: sxemalar (kam rangli) — lossless,
    3D rasmlar — sifat 92 (lossless hajmi 1,5 baravardan oshmasa lossless tanlanadi).
Pillow kerak (Anaconda python).
"""
import io
import os
import sys

from PIL import Image, ImageChops

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'content', 'figures', 'img')
MAX_SIDE = 2400
PAD = 0.025  # kesilgandan keyin qoldiriladigan oq chekka (eng uzun tomonga nisbatan)
EXTS = ('.png', '.webp', '.jpg', '.jpeg')


def trim(im):
    rgb = im.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    # 1) erase frame lines near the edges: a column/row in the outer 6% band where
    #    light-grey, unsaturated pixels run along more than half of the side.
    #    Only those grey pixels are painted white, so coloured drawing and dark text stay.
    def greyish(p):
        return max(p) - min(p) < 25 and 120 < p[0] < 245
    band_x, band_y = int(w * 0.06), int(h * 0.06)
    for x in list(range(band_x)) + list(range(w - band_x, w)):
        if sum(1 for y in range(0, h, 2) if greyish(px[x, y])) > 0.25 * h:
            for y in range(h):
                if greyish(px[x, y]):
                    px[x, y] = (255, 255, 255)
    for y in list(range(band_y)) + list(range(h - band_y, h)):
        if sum(1 for x in range(0, w, 2) if greyish(px[x, y])) > 0.25 * w:
            for x in range(w):
                if greyish(px[x, y]):
                    px[x, y] = (255, 255, 255)
    # 2) trim the white margins
    bg = Image.new('RGB', rgb.size, (255, 255, 255))
    box = ImageChops.difference(rgb, bg).convert('L').point(lambda v: 255 if v > 18 else 0).getbbox()
    if not box:
        return rgb
    content = rgb.crop(box)
    pad = int(max(content.size) * PAD)
    canvas = Image.new('RGB', (content.width + 2 * pad, content.height + 2 * pad), (255, 255, 255))
    canvas.paste(content, (pad, pad))
    return canvas


def encode(im):
    lossy = io.BytesIO()
    im.save(lossy, 'WEBP', quality=92, method=6)
    lossless = io.BytesIO()
    im.save(lossless, 'WEBP', lossless=True, quality=100, method=6)
    if lossless.tell() <= 1.5 * lossy.tell():
        return lossless.getvalue(), 'lossless'
    return lossy.getvalue(), 'q92'


def process(src, fid):
    im = trim(Image.open(src))
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    data, mode = encode(im)
    with open(os.path.join(OUT, fid + '.webp'), 'wb') as f:
        f.write(data)
    print(f'{fid}: {im.size[0]}x{im.size[1]} {mode} {len(data) // 1024} KB')


def main(args):
    os.makedirs(OUT, exist_ok=True)
    if args[:1] == ['--map']:
        base = os.path.dirname(os.path.abspath(args[1]))
        for ln in open(args[1], encoding='utf-8'):
            if ln.strip() and not ln.startswith('#'):
                src, fid = [x.strip() for x in ln.split('\t')]
                process(os.path.join(base, src) if not os.path.isabs(src) else src, fid)
        return
    for d in args:
        for name in sorted(os.listdir(d)):
            stem, ext = os.path.splitext(name)
            if name.startswith('r-ch') and ext.lower() in EXTS:
                process(os.path.join(d, name), stem)


if __name__ == '__main__':
    main(sys.argv[1:])
