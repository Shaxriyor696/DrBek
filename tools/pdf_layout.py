"""PDF layout helpers for the Guyton & Hall 14th ed. PDF.

Classifies text blocks on a page into header/footer, prose (body text and
headings), captions (Figure N-M / Table N-M) and graphic labels, then groups
graphic elements (embedded images, vector drawings, label text) into figure
regions assigned to the nearest caption.
"""
import re
import pymupdf

CAP_RE = re.compile(r"^\s*(Figure|Table)\s+(\d+)\s*[-–­]+\s*(\d+)[\.\s]")
BODY_FONTS = ("WarnockPro",)
GAP = 5


def norm(s):
    return s.replace("­", "").replace(" ", " ").replace(" ", " ").replace("\t", " ")


def block_text(b):
    lines = []
    for l in b["lines"]:
        lines.append("".join(s["text"] for s in l["spans"]))
    return lines


def font_profile(b):
    tot = 0
    body = 0
    sizes = {}
    fonts = {}
    for l in b["lines"]:
        for s in l["spans"]:
            n = len(s["text"].strip())
            if not n:
                continue
            tot += n
            if s["font"].startswith(BODY_FONTS) and s["size"] >= 8.5:
                body += n
            fonts[s["font"]] = fonts.get(s["font"], 0) + n
            k = round(s["size"], 1)
            sizes[k] = sizes.get(k, 0) + n
    return tot, body, fonts, sizes


def classify(page):
    W, H = page.rect.width, page.rect.height
    d = page.get_text("dict")
    out = []
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        x0, y0, x1, y1 = b["bbox"]
        txt = norm(" ".join(block_text(b))).strip()
        if not txt:
            continue
        tot, body, fonts, sizes = font_profile(b)
        kind = "label"
        if y1 < 40 or y0 > 735 or x0 > 560:
            kind = "hf"
        elif CAP_RE.match(txt) and b["lines"][0]["spans"][0]["font"].startswith("Frutiger") and b["lines"][0]["spans"][0]["size"] < 9.2:
            kind = "caption"
        else:
            main_font = max(fonts, key=fonts.get) if fonts else ""
            main_size = max(sizes, key=sizes.get) if sizes else 0
            if tot and body / tot > 0.5:
                kind = "prose"
            elif main_font.startswith("Frutiger-B") and main_size >= 9.4 and (x1 - x0) > 120:
                kind = "prose"  # headings
            elif main_font.startswith("Frutiger-Black") and main_size >= 10:
                kind = "prose"
        out.append({"kind": kind, "bbox": [x0, y0, x1, y1], "text": txt, "block": b})
    return out


def _merge(rects, gap=6):
    rects = [list(r) for r in rects]
    changed = True
    while changed:
        changed = False
        res = []
        while rects:
            r = rects.pop()
            i = 0
            while i < len(rects):
                q = rects[i]
                if q[0] - gap <= r[2] and r[0] - gap <= q[2] and q[1] - gap <= r[3] and r[1] - gap <= q[3]:
                    r = [min(r[0], q[0]), min(r[1], q[1]), max(r[2], q[2]), max(r[3], q[3])]
                    rects.pop(i)
                    changed = True
                else:
                    i += 1
            res.append(r)
        rects = res
    return rects


def _overlap(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _dist(a, b):
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return (dx * dx + dy * dy) ** 0.5


def _center_in(e, r):
    cx, cy = (e[0] + e[2]) / 2, (e[1] + e[3]) / 2
    return r[0] <= cx <= r[2] and r[1] <= cy <= r[3]


def _union(rs):
    return [min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)]


def figure_regions(page):
    """Return list of dicts {kind, chapter, num, caption, cap_bbox, bbox, method}."""
    W, H = page.rect.width, page.rect.height
    blocks = classify(page)
    prose = [b["bbox"] for b in blocks if b["kind"] == "prose"]
    caps = [b for b in blocks if b["kind"] == "caption"]
    if not caps:
        return []
    elems = [b["bbox"] for b in blocks if b["kind"] == "label"]
    for info in page.get_image_info():
        r = info["bbox"]
        if r[2] - r[0] < 1 or r[3] - r[1] < 1:
            continue
        elems.append(list(r))
    for dr in page.get_drawings():
        r = dr["rect"]
        if r.width * r.height > 0.6 * W * H:
            continue
        rr = [max(0, r.x0), max(0, r.y0), min(W, r.x1), min(H, r.y1)]
        if rr[2] - rr[0] < 0.5 and rr[3] - rr[1] < 0.5:
            continue
        if any(_overlap(rr, p) and (rr[2]-rr[0])*(rr[3]-rr[1]) > 4000 for p in prose):
            continue
        elems.append(rr)
    elems = [e for e in elems if e[2] > 45 and e[0] < 565 and e[3] > 40 and e[1] < 740]
    barriers = prose + [c["bbox"] for c in caps]
    claimed = [None] * len(elems)
    regions = {}
    # pass A: figure above its caption, inside the caption's column span
    for ci, c in enumerate(caps):
        cx0, cy0, cx1, cy1 = c["bbox"]
        if cx1 - cx0 > 300 or (cx0 < 290 and cx1 > 320):
            col = [50, 546]
        elif cx0 < 300:
            col = [50, 298]
        else:
            col = [302, 546]
        top = 40
        for b in barriers:
            if b is c["bbox"]:
                continue
            if b[3] <= cy0 + 2 and b[0] < col[1] and b[2] > col[0] and b[3] > top:
                top = b[3]
        reg = [col[0], top, col[1], cy0 + 1]
        mine = [k for k, e in enumerate(elems) if claimed[k] is None and _center_in(e, reg)]
        if mine and (_union([elems[k] for k in mine])[3] - _union([elems[k] for k in mine])[1]) > 25:
            for k in mine:
                claimed[k] = ci
            regions[ci] = "above"
    # pass B: expand with touching unclaimed elements; side captions take nearest unclaimed clusters
    free = [k for k in range(len(elems)) if claimed[k] is None]
    clusters = _merge([elems[k] for k in free], gap=GAP)
    for cl in clusters:
        if (cl[2] - cl[0]) * (cl[3] - cl[1]) < 150:
            continue
        best, bd = None, 1e9
        for ci, c in enumerate(caps):
            own = [elems[k] for k in range(len(elems)) if claimed[k] == ci]
            if own:
                bb = _union(own)
                dd = _dist(cl, bb)
                if dd < 3 and dd < bd:
                    best, bd = ci, dd
        if best is None:
            for ci, c in enumerate(caps):
                if ci in regions:
                    continue
                dd = _dist(cl, c["bbox"])
                if dd < 150 and dd < bd:
                    best, bd = ci, dd
        if best is not None:
            for k in free:
                if claimed[k] is None and _center_in(elems[k], cl):
                    claimed[k] = best
            regions.setdefault(best, "side")
    res = []
    for ci, cap in enumerate(caps):
        m = CAP_RE.match(cap["text"])
        own = [elems[k] for k in range(len(elems)) if claimed[k] == ci]
        bb = _union(own) if own else None
        if bb:
            for b in barriers:
                if b is cap["bbox"] or not _overlap(bb, b):
                    continue
                opts = [
                    [bb[0], bb[1], b[0] - 1, bb[3]],
                    [b[2] + 1, bb[1], bb[2], bb[3]],
                    [bb[0], bb[1], bb[2], b[1] - 1],
                    [bb[0], b[3] + 1, bb[2], bb[3]],
                ]
                opts = [o for o in opts if o[2] - o[0] > 10 and o[3] - o[1] > 10]
                if opts:
                    bb = max(opts, key=lambda o: (o[2] - o[0]) * (o[3] - o[1]))
        res.append({
            "kind": m.group(1).lower(),
            "chapter": int(m.group(2)),
            "num": int(m.group(3)),
            "caption": cap["text"],
            "cap_bbox": cap["bbox"],
            "bbox": bb,
            "method": regions.get(ci),
        })
    return res
