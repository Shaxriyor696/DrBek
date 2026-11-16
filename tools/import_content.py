"""DrStudy content import (idempotent).

Builds the versioned content files the app serves, from:
  * the Guyton & Hall 14th ed. PDF (original text + figure/table crops),
  * the earlier study notes in guyton-notes/ (chapter index chNN-*.md and the
    Uzbek study summaries summaries/chNN.md),
  * the UI package topics.json (15 stable topics and their planned sections).

Nothing here writes new medical content: every lesson block is either the
book's own text (original language, English) or the earlier Uzbek summary,
each tagged with its source and review status.

Usage:
  python3 tools/import_content.py --pdf BOOK.pdf --notes guyton-notes \
      --ui-topics topics.json --out content [--zoom 3] [--skip-images]
"""
import argparse
import datetime
import hashlib
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pymupdf  # noqa: E402
from PIL import Image  # noqa: E402
import pdf_layout as L  # noqa: E402

BOOK_ID = "guyton-hall-14"
CONTENT_VERSION = "2026-11-14.1"
PAGE_OFFSET = 5  # printed page = PDF page - 5 (verified in guyton-notes/README.md)

# The 15 topics = the book's 15 units, in order. Card descriptions come from
# "Fiziologiya_15_mavzu_3D_rasmlar.docx"; titles/images from the UI package.
UNIT_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"]
DOCX_DESCRIPTIONS = {
    1: "Hujayra tuzilishi, organellalar, DNK va oqsil sintezi.",
    2: "Membrana orqali moddalar almashinuvi, nerv impulsi va mushak qisqarishi.",
    3: "Yurakning nasos faoliyati, ritmi, elektr faolligi va EKG.",
    4: "Qon tomirlarida qon oqimi va arterial bosimning boshqarilishi.",
    5: "Buyrak, nefron va organizmdagi suv hamda tuzlar muvozanati.",
    6: "Eritrotsitlar, infeksiyaga qarshi himoya va qon ivishi.",
    7: "O’pka va alveolalarda kislorod hamda karbonat angidrid almashinuvi.",
    8: "Balandlik, mikrogravitatsiya va bosim o’zgarishlarining organizmga ta’siri.",
    9: "Sinapslar, retseptorlar, teginish, og’riq va harorat sezgisi.",
    10: "Ko’rish, eshitish, ta’m va hid bilish organlari.",
    11: "Miya, miyacha, orqa miya, harakat boshqaruvi va xotira.",
    12: "Ovqatning harakatlanishi, hazm bo’lishi va oziq moddalarning so’rilishi.",
    13: "Energiya almashinuvi, jigar faoliyati va tana haroratining boshqarilishi.",
    14: "Endokrin bezlar, gormonlar, ko’payish va homiladorlik.",
    15: "Jismoniy mashqda mushak, yurak va nafas tizimining moslashuvi.",
}

# Old planned section IDs (UI package / PRD appendix A) -> book chapter that
# holds that content. Kept so old links keep working (PRD 26: alias/migration).
ALIASES = {
    "01-01": "ch01", "01-02": "ch02", "01-03": "ch02", "01-04": "ch03",
    "02-01": "ch04", "02-02": "ch05", "02-03": "ch05", "02-04": "ch07", "02-05": "ch06",
    "03-01": "ch09", "03-02": "ch09", "03-03": "ch09", "03-04": "ch10", "03-05": "ch11", "03-06": "ch09",
    "04-01": "ch14", "04-02": "ch15", "04-03": "ch16", "04-04": "ch20", "04-05": "ch18",
    "05-01": "ch25", "05-02": "ch26", "05-03": "ch27", "05-04": "ch28", "05-05": "ch29", "05-06": "ch31",
    "06-01": "ch33", "06-02": "ch34", "06-03": "ch35", "06-04": "ch37", "06-05": "ch37",
    "07-01": "ch38", "07-02": "ch38", "07-03": "ch40", "07-04": "ch41", "07-05": "ch42",
    "08-01": "ch44", "08-02": "ch44", "08-03": "ch44", "08-04": "ch45", "08-05": "ch45",
    "09-01": "ch46", "09-02": "ch46", "09-03": "ch47", "09-04": "ch48", "09-05": "ch49",
    "10-01": "ch50", "10-02": "ch53", "10-03": "ch56", "10-04": "ch54", "10-05": "ch54",
    "11-01": "ch55", "11-02": "ch56", "11-03": "ch57", "11-04": "ch58", "11-05": "ch60",
    "12-01": "ch64", "12-02": "ch65", "12-03": "ch65", "12-04": "ch66", "12-05": "ch63",
    "13-01": "ch68", "13-02": "ch68", "13-03": "ch69", "13-04": "ch71", "13-05": "ch74",
    "14-01": "ch75", "14-02": "ch76", "14-03": "ch77", "14-04": "ch79", "14-05": "ch81", "14-06": "ch83",
    "15-01": "ch85", "15-02": "ch85", "15-03": "ch85", "15-04": "ch85", "15-05": "ch85",
}


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def slug(s):
    s = s.lower()
    s = re.sub(r"[‘’'ʻʼ`]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60] or "x"


def norm_head(s):
    s = L.norm(s).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


# ---------------------------------------------------------------- notes
def parse_readme(notes):
    txt = open(os.path.join(notes, "README.md"), encoding="utf-8").read()
    units = []
    cur = None
    for line in txt.splitlines():
        m = re.match(r"\|\s*\|\s*\*\*Unit ([IVX]+): (.+?)\*\*", line)
        if m:
            cur = {"roman": m.group(1), "title": m.group(2).strip(), "chapters": []}
            units.append(cur)
            continue
        m = re.match(r"\|\s*(\d+)\s*\|\s*\[(.+?)\]\((.+?)\)\s*\|\s*(\d+)[–-](\d+)\s*\|\s*(\d+)\s*\|", line)
        if m and cur is not None:
            cur["chapters"].append({
                "num": int(m.group(1)), "title": m.group(2), "file": m.group(3),
                "pdfStart": int(m.group(4)), "pdfEnd": int(m.group(5)), "words": int(m.group(6)),
            })
    return units


def parse_chapter_notes(path):
    txt = open(path, encoding="utf-8").read()
    sec = {}
    cur = None
    for line in txt.splitlines():
        m = re.match(r"^## (\d)\. ", line)
        if m:
            cur = int(m.group(1))
            sec[cur] = []
            continue
        if cur is not None:
            sec[cur].append(line)
    outline = []
    for line in sec.get(1, []):
        m = re.match(r"^(\s*)- (.+?) — p\.(\d+)\s*$", line)
        if m:
            outline.append({"level": len(m.group(1)) // 2 + 1, "title": L.norm(m.group(2)).strip(), "pdfPage": int(m.group(3))})
    figs = []
    for key in (2, 3):
        for line in sec.get(key, []):
            m = re.match(r"- \*\*(Figure|Table) (\d+)-(\d+)\*\* \(p\.(\d+)\): (.*)", line)
            if m:
                figs.append({"kind": m.group(1).lower(), "chapter": int(m.group(2)), "num": int(m.group(3)),
                             "pdfPage": int(m.group(4)), "caption": m.group(5).strip()})
    defs = []
    for line in sec.get(4, []):
        m = re.match(r"- \(p\.(\d+)\) (.*)", line)
        if m:
            defs.append({"pdfPage": int(m.group(1)), "text": m.group(2).strip()})
    nums = []
    for line in sec.get(5, []):
        m = re.match(r"- \(p\.(\d+)\) (.*)", line)
        if m:
            nums.append({"pdfPage": int(m.group(1)), "text": m.group(2).strip()})
    return outline, figs, defs, nums


FIG_REF_UZ = re.compile(r"(?:Fig\.|Figure|Rasm|rasm)\s*(\d+)[-–](\d+)((?:\s*[,;]\s*(?:\d+[-–])?\d+)*)")
TAB_REF_UZ = re.compile(r"(?:Table|Jadval|jadval)\s*(\d+)[-–](\d+)")
PAGE_RANGE = re.compile(r"\(p\.?\s*(\d+)(?:\s*[–-]\s*(\d+))?")


def fig_refs(text):
    out = []
    for m in FIG_REF_UZ.finditer(text):
        ch = int(m.group(1))
        out.append(("figure", ch, int(m.group(2))))
        for extra in re.findall(r"(?:(\d+)[-–])?(\d+)", m.group(3) or ""):
            c2 = int(extra[0]) if extra[0] else ch
            out.append(("figure", c2, int(extra[1])))
    for m in TAB_REF_UZ.finditer(text):
        out.append(("table", int(m.group(1)), int(m.group(2))))
    return out


def parse_summary(path):
    """Uzbek summary markdown -> structured blocks."""
    lines = open(path, encoding="utf-8").read().splitlines()
    blocks = []
    title = None
    subtitle = None
    i = 0
    para = []

    def flush():
        if para:
            blocks.append({"type": "paragraph", "text": " ".join(para).strip()})
            para.clear()

    while i < len(lines):
        line = lines[i].rstrip()
        if line.startswith("# ") and title is None:
            title = line[2:].strip()
            i += 1
            continue
        if title is not None and subtitle is None and line.startswith("*") and not line.startswith("**") and not blocks:
            subtitle = line.strip()
            i += 1
            continue
        m = re.match(r"^(#{2,4}) (.*)", line)
        if m:
            flush()
            text = m.group(2).strip()
            pm = PAGE_RANGE.search(text)
            blk = {"type": "heading", "level": len(m.group(1)), "text": text}
            if pm:
                blk["pdfPages"] = [int(pm.group(1)), int(pm.group(2) or pm.group(1))]
            blocks.append(blk)
            i += 1
            continue
        if line.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                r = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.match(r"^:?-{2,}:?$", c) for c in r if c):
                    rows.append(r)
                i += 1
            if rows:
                blocks.append({"type": "table", "header": rows[0], "rows": rows[1:]})
            continue
        m = re.match(r"^(\s*)([-*]|\d+\.) (.*)", line)
        if m:
            flush()
            ordered = m.group(2)[0].isdigit()
            items = []
            while i < len(lines):
                mm = re.match(r"^(\s*)([-*]|\d+\.) (.*)", lines[i])
                if mm:
                    items.append({"text": mm.group(3).strip(), "depth": len(mm.group(1)) // 2})
                    i += 1
                elif lines[i].startswith("  ") and lines[i].strip() and items:
                    items[-1]["text"] += " " + lines[i].strip()
                    i += 1
                else:
                    break
            blocks.append({"type": "list", "ordered": ordered, "items": items})
            continue
        if not line.strip():
            flush()
            i += 1
            continue
        if line.startswith(">"):
            flush()
            blocks.append({"type": "callout", "text": line.lstrip("> ").strip()})
            i += 1
            continue
        para.append(line.strip())
        i += 1
    flush()
    return title, subtitle, blocks


def block_plain(b):
    if b["type"] == "list":
        return " ".join(it["text"] for it in b["items"])
    if b["type"] == "table":
        return " ".join(" ".join(r) for r in [b["header"]] + b["rows"])
    return b.get("text", "")


# ---------------------------------------------------------------- PDF text
def span_markup(spans):
    """Spans -> light inline markup: **bold** for key terms, _italic_."""
    segs = []
    for s in spans:
        t = L.norm(s["text"]).replace("*", "\u2217").replace("_", " ")
        if not t:
            continue
        f = s["font"]
        style = ""
        if ("Bold" in f or "Semibold" in f or "Black" in f) and not f.startswith("Frutiger-B"):
            style = "**"
        elif "It" in f.split("-")[-1] or "Italic" in f or "Oblique" in f:
            style = "_"
        if segs and segs[-1][1] == style:
            segs[-1][0] += t
        else:
            segs.append([t, style])
    res = ""
    for t, st in segs:
        core = t.strip()
        if not st or not core:
            res += t
            continue
        lead = t[: len(t) - len(t.lstrip())]
        trail = t[len(t.rstrip()):]
        res += lead + st + core + st + trail
    return res


def join_lines(lines):
    text = ""
    for ln in lines:
        ln = ln.rstrip()
        if not ln:
            continue
        if text.endswith("-") and ln[:1].islower() and not text.endswith(" -"):
            text = text[:-1] + ln.lstrip()
        elif text:
            text += " " + ln.lstrip()
        else:
            text = ln
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("-** **", "").replace("** **", " ").replace("-_ _", "").replace("_ _", " ")
    return text


def prose_blocks_for_page(page):
    blocks = L.classify(page)
    out = []
    for b in blocks:
        if b["kind"] != "prose":
            continue
        raw = b["block"]
        txt = b["text"].strip()
        if re.match(r"^(CHAPTER\s*)?\d*$", txt) or txt.startswith("U N I T"):
            continue
        sizes = [s["size"] for l in raw["lines"] for s in l["spans"] if s["text"].strip()]
        fonts = [s["font"] for l in raw["lines"] for s in l["spans"] if s["text"].strip()]
        if sizes and max(sizes) >= 18:
            continue  # chapter title display block
        first_font = fonts[0] if fonts else ""
        first_size = sizes[0] if sizes else 0
        all_head = all(f.startswith("Frutiger") for f in fonts)
        lines = [span_markup(l["spans"]) for l in raw["lines"]]
        text = join_lines(lines)
        x0, y0, x1, y1 = b["bbox"]
        col = 0 if (x1 - x0) > 320 else (1 if x0 < 300 else 2)
        kind = "paragraph"
        if all_head and first_size >= 10.5:
            kind = "heading"
            text = join_lines([L.norm("".join(s["text"] for s in l["spans"])) for l in raw["lines"]])
        boxed = bool(sizes) and sum(1 for s in sizes if abs(s - 9.0) < 0.3) > len(sizes) / 2
        lead = None
        if kind == "paragraph" and first_font.startswith("Frutiger-B"):
            # run-in heading: leading bold Frutiger spans
            lead_spans = []
            for l in raw["lines"]:
                for s in l["spans"]:
                    if s["font"].startswith("Frutiger-B") or (not s["text"].strip() and not lead_spans == []):
                        lead_spans.append(L.norm(s["text"]))
                    else:
                        break
                else:
                    continue
                break
            lead_txt = re.sub(r"\s+", " ", "".join(lead_spans)).strip()
            if lead_txt and len(lead_txt) < 200:
                lead = lead_txt
                body_lines = []
                consumed = 0
                for l in raw["lines"]:
                    spans_out = []
                    for s in l["spans"]:
                        if consumed < len(lead_spans):
                            consumed += 1
                            continue
                        spans_out.append(s)
                    body_lines.append(span_markup(spans_out))
                text = join_lines(body_lines)
        out.append({"kind": kind, "text": text, "lead": lead, "boxed": boxed, "col": col,
                    "y": y0, "page": page.number + 1})
    out.sort(key=lambda b: (0 if b["col"] == 0 and b["y"] < 200 else b["col"] if b["col"] else 3, b["y"]))
    return out


def build_full_text(doc, ch):
    raw = []
    for pno in range(ch["pdfStart"], ch["pdfEnd"] + 1):
        raw.extend(prose_blocks_for_page(doc[pno - 1]))
    blocks = []
    for b in raw:
        if b["kind"] == "heading":
            blocks.append({"type": "heading", "level": 3, "text": b["text"], "pdfPage": b["page"]})
            continue
        prev = blocks[-1] if blocks else None
        if (prev and prev["type"] == "paragraph" and not b["lead"] and b["text"][:1].islower()
                and not re.search(r"[.:?!”)]$", prev["text"])):
            if prev["text"].endswith("-"):
                prev["text"] = prev["text"][:-1] + b["text"]
            else:
                prev["text"] += " " + b["text"]
            if b["page"] != prev["pdfPage"]:
                prev["pdfPageEnd"] = b["page"]
            continue
        if not b["lead"]:
            m = re.match(r"^\*\*([^*]{3,200}?[.:?])\*\*\s*(.*)$", b["text"])
            if m:
                b["lead"] = m.group(1).strip()
                b["text"] = m.group(2)
        blk = {"type": "paragraph", "text": b["text"], "pdfPage": b["page"]}
        if b["lead"]:
            blk["lead"] = b["lead"]
        if b["boxed"]:
            blk["boxed"] = True
        blocks.append(blk)
    # Bibliography: collapse into a single block
    out = []
    bib = None
    for b in blocks:
        if b["type"] == "heading" and b["text"].strip().lower() == "bibliography":
            bib = {"type": "bibliography", "items": [], "pdfPage": b["pdfPage"]}
            out.append(bib)
            continue
        if bib is not None and b["type"] == "paragraph":
            bib["items"].append(b["text"])
            continue
        out.append(b)
    return out


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--notes", required=True)
    ap.add_argument("--ui-topics", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--zoom", type=float, default=3.0)
    ap.add_argument("--skip-images", action="store_true")
    ap.add_argument("--only", default="", help="comma list of chapter numbers (debug)")
    a = ap.parse_args()

    out = a.out
    os.makedirs(os.path.join(out, "lessons"), exist_ok=True)
    os.makedirs(os.path.join(out, "figures", "img"), exist_ok=True)
    pdf_bytes = open(a.pdf, "rb").read()
    pdf_sha = sha256(pdf_bytes)
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    units = parse_readme(a.notes)
    assert len(units) == 15, f"expected 15 units, got {len(units)}"
    ui_topics = json.load(open(a.ui_topics, encoding="utf-8"))
    only = {int(x) for x in a.only.split(",") if x}

    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    book = {
        "id": BOOK_ID,
        "title": "Guyton and Hall Textbook of Medical Physiology",
        "authors": ["John E. Hall"],
        "edition": "14th edition",
        "year": 2021,
        "publisher": "Elsevier",
        "originalLanguage": "en",
        "pdf": {"pages": doc.page_count, "sha256": pdf_sha, "printedPageOffset": PAGE_OFFSET},
        "usageStatus": "private_user_copy",
        "usageNote": "Foydalanuvchi bergan shaxsiy PDF nusxa. Ommaviy joylashdan oldin nashriyot ruxsatini tekshiring.",
    }
    # Year/publisher are read from the PDF front matter if available.
    fm = os.path.join(a.notes, "text", "front-matter-preface.txt")
    if os.path.exists(fm):
        t = open(fm, encoding="utf-8").read()
        m = re.search(r"Copyright\s*©\s*(\d{4})", t)
        book["year"] = int(m.group(1)) if m else None
        book["publisher"] = "Elsevier" if "Elsevier" in t else None
        if "Michael E. Hall" in t:
            book["authors"] = ["John E. Hall", "Michael E. Hall"]

    # figure detection over all chapter pages (once)
    det_cache = os.path.join(out, "figures", ".detect-cache.json")
    det = None
    if os.path.exists(det_cache):
        c = json.load(open(det_cache))
        if c.get("pdf") == pdf_sha and c.get("layoutVersion") == 3:
            det = c["items"]
    if det is None:
        det = []
        for pno in range(1, doc.page_count + 1):
            for f in L.figure_regions(doc[pno - 1]):
                f["page"] = pno
                det.append(f)
        json.dump({"pdf": pdf_sha, "layoutVersion": 3, "items": det}, open(det_cache, "w"))
    det_by_key = {}
    for f in det:
        det_by_key.setdefault((f["kind"], f["chapter"], f["num"]), []).append(f)

    manifest_path = os.path.join(out, "figures", "manifest.json")
    old_manifest = {}
    if os.path.exists(manifest_path):
        for f in json.load(open(manifest_path, encoding="utf-8"))["figures"]:
            old_manifest[f["imageId"]] = f

    topics = []
    lessons_index = []
    figures = []
    glossary = []
    coverage = []
    inventory = []

    for ui in ui_topics:
        tid = ui["id"]
        unit = units[tid - 1]
        topic = {
            "id": f"{tid:02d}",
            "order": tid,
            "title": ui["title"],
            "description": DOCX_DESCRIPTIONS[tid],
            "cardImage": f"/assets/topics/topic_{tid:02d}.webp",
            "cardImageSource": "Fiziologiya_15_mavzu_3D_rasmlar.docx / DrStudy_Toliq_UI assets (3D muqova, kitob rasmi emas)",
            "bookUnit": {"bookId": BOOK_ID, "unit": unit["roman"], "title": unit["title"]},
            "sections": [],
            "plannedSections": [{"id": s["id"], "title": s["title"], "aliasOf": ALIASES.get(s["id"])} for s in ui["sections"]],
        }
        tcov = {"topicId": topic["id"], "bookUnit": unit["roman"], "chapters": [],
                "sourceSections": {"expected": 0, "found": 0, "reviewed": 0, "published": 0},
                "figures": {"expected": 0, "included": 0, "needsReview": 0, "missing": 0, "reviewed": 0},
                "summaryUz": {"chapters": 0, "found": 0}, "questions": 0, "missing": []}
        for order, ch in enumerate(unit["chapters"], 1):
            n = ch["num"]
            sid = f"ch{n:02d}"
            if only and n not in only:
                # keep previous lesson file if present
                p = os.path.join(out, "lessons", f"{sid}.json")
                if os.path.exists(p):
                    les = json.load(open(p, encoding="utf-8"))
                    topic["sections"].append({k: les[k] for k in ("id", "order", "titleUz", "titleOriginal", "pdfPages", "printedPages", "estMinutes", "status", "counts")})
                continue
            notes_path = os.path.join(a.notes, ch["file"])
            outline, figlist, defs, nums = parse_chapter_notes(notes_path)
            sum_path = os.path.join(a.notes, "summaries", f"ch{n:02d}.md")
            has_sum = os.path.exists(sum_path)
            title_uz, subtitle, simple = (None, None, [])
            if has_sum:
                title_uz, subtitle, simple = parse_summary(sum_path)
            title_uz_clean = re.sub(r"^\d+-bob\.\s*", "", title_uz or "").strip() or ch["title"]

            full = build_full_text(doc, ch)
            # map heading levels from the outline (book's own hierarchy)
            ol = {norm_head(o["title"]): o["level"] for o in outline}
            for b in full:
                if b["type"] == "heading":
                    lvl = ol.get(norm_head(b["text"]))
                    b["level"] = min(4, (lvl or 2) + 1)
                    b["id"] = f"{sid}-h-{slug(b['text'])}"
                if b.get("lead"):
                    lvl = ol.get(norm_head(b["lead"].rstrip(".")))
                    if lvl is not None:
                        b["anchor"] = f"{sid}-h-{slug(b['lead'])}"

            # figures for this chapter: union of notes list and detected captions
            keys = {}
            for f in figlist:
                keys[(f["kind"], f["chapter"], f["num"])] = {"notesPage": f["pdfPage"], "notesCaption": f["caption"]}
            for f in det:
                if f["chapter"] == n and ch["pdfStart"] <= f["page"] <= ch["pdfEnd"]:
                    keys.setdefault((f["kind"], f["chapter"], f["num"]), {})
            ch_figs = []
            for key in sorted(keys, key=lambda k: (k[0] != "figure", k[2])):
                kind, c, num = key
                cands = [x for x in det_by_key.get(key, []) if ch["pdfStart"] <= x["page"] <= ch["pdfEnd"]]
                cands.sort(key=lambda x: (x["bbox"] is None, abs(x["page"] - keys[key].get("notesPage", x["page"]))))
                d0 = cands[0] if cands else None
                img_id = f"gh14-{'fig' if kind == 'figure' else 'tab'}-{c:02d}-{num:02d}"
                label = f"{'Figure' if kind == 'figure' else 'Table'} {c}-{num}"
                page = d0["page"] if d0 else keys[key].get("notesPage")
                caption = L.norm(d0["caption"]) if d0 else keys[key].get("notesCaption")
                if caption:
                    caption = re.sub(r"\s+", " ", caption).strip()
                rec = {
                    "imageId": img_id, "kind": kind, "bookEditionId": BOOK_ID,
                    "figureNumber": label,
                    "pdfPageIndex": (page - 1) if page else None,
                    "pdfPage": page,
                    "printedPageLabel": str(page - PAGE_OFFSET) if page else None,
                    "originalCaption": caption,
                    "captionUz": None, "altTextUz": None,
                    "sourceSectionId": sid, "topicId": topic["id"], "lessonId": sid,
                    "assetPath": None, "dimensions": None, "checksum": None,
                    "cropMethod": None, "cropBox": None,
                    "reviewStatus": "needs_review", "usageStatus": "private_user_copy",
                    "coverage": "missing",
                }
                if d0 and page:
                    pg = doc[page - 1]
                    if d0["bbox"]:
                        bb = d0["bbox"]
                        r = pymupdf.Rect(bb) + (-4, -4, 4, 4)
                        r = r & pg.rect
                        rec["cropMethod"] = "auto_region_" + (d0.get("method") or "unknown")
                    else:
                        r = pymupdf.Rect(36, 40, pg.rect.width - 36, 740)
                        rec["cropMethod"] = "full_page_fallback"
                    rec["cropBox"] = [round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)]
                    fname = f"{img_id}.webp"
                    fpath = os.path.join(out, "figures", "img", fname)
                    if not a.skip_images or not os.path.exists(fpath):
                        pix = pg.get_pixmap(matrix=pymupdf.Matrix(a.zoom, a.zoom), clip=r, alpha=False)
                        im = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
                        buf = io.BytesIO()
                        im.save(buf, "WEBP", quality=86, method=4)
                        data = buf.getvalue()
                        old = open(fpath, "rb").read() if os.path.exists(fpath) else None
                        if old != data:
                            open(fpath, "wb").write(data)
                        rec["dimensions"] = [im.width, im.height]
                    else:
                        data = open(fpath, "rb").read()
                        im = Image.open(fpath)
                        rec["dimensions"] = [im.width, im.height]
                    rec["checksum"] = "sha256:" + sha256(data)
                    rec["assetPath"] = f"figures/img/{fname}"
                    rec["coverage"] = "included" if rec["cropMethod"] != "full_page_fallback" else "needs_review"
                    # status: automatic crops are machine-made, so they stay needs_review
                    # unless a reviewer approved this exact checksum earlier.
                    prev = old_manifest.get(img_id)
                    if prev and prev.get("reviewStatus") == "approved" and prev.get("checksum") == rec["checksum"]:
                        rec["reviewStatus"] = "approved"
                        rec["reviewedBy"] = prev.get("reviewedBy")
                        rec["reviewedAt"] = prev.get("reviewedAt")
                ch_figs.append(rec)
            figures.extend(ch_figs)
            fig_by_label = {(f["kind"], int(f["figureNumber"].split()[1].split("-")[0]), int(f["figureNumber"].split("-")[1])): f for f in ch_figs}

            # place figures in the original text: after first paragraph that mentions it,
            # else after the last block on its page.
            placed = set()
            new_full = []
            pending = {}
            for b in full:
                new_full.append(b)
                if b["type"] != "paragraph":
                    continue
                txt = b["text"]
                for m in re.finditer(r"(Figures?|Tables?)\s+(\d+)\s*-\s*(\d+)((?:\s*(?:,|and|to|through|–)\s*(?:\d+\s*-\s*)?\d+)*)", txt.replace("**", "")):
                    kind = "figure" if m.group(1).startswith("Figure") else "table"
                    c = int(m.group(2))
                    nums_ = [int(m.group(3))]
                    for e in re.findall(r"(?:(\d+)\s*-\s*)?(\d+)", m.group(4) or ""):
                        if not e[0] or int(e[0]) == c:
                            nums_.append(int(e[1]))
                    for num in nums_:
                        k = (kind, c, num)
                        if k in fig_by_label and k not in placed:
                            placed.add(k)
                            new_full.append({"type": "figure", "imageId": fig_by_label[k]["imageId"]})
            for k, f in fig_by_label.items():
                if k in placed:
                    continue
                # insert after last paragraph on that page
                idx = None
                for i, b in enumerate(new_full):
                    if b.get("pdfPage") and f["pdfPage"] and b["pdfPage"] <= f["pdfPage"]:
                        idx = i
                new_full.insert((idx + 1) if idx is not None else len(new_full), {"type": "figure", "imageId": f["imageId"]})
                placed.add(k)
            full = new_full

            # place figures in the Uzbek summary: after the block that cites them,
            # else under the heading whose page range covers the figure page.
            simple_out = []
            splaced = set()
            for b in simple:
                simple_out.append(b)
                if b["type"] in ("heading",):
                    continue
                for k in fig_refs(block_plain(b)):
                    if k in fig_by_label and k not in splaced:
                        splaced.add(k)
                        simple_out.append({"type": "figure", "imageId": fig_by_label[k]["imageId"]})
            # headings referencing figures: place at the end of that heading's section
            heads = [i for i, b in enumerate(simple_out) if b["type"] == "heading"]
            inserts = []
            for hi, i in enumerate(heads):
                for k in fig_refs(simple_out[i]["text"]):
                    if k in fig_by_label and k not in splaced:
                        splaced.add(k)
                        end = heads[hi + 1] if hi + 1 < len(heads) else len(simple_out)
                        inserts.append((end, {"type": "figure", "imageId": fig_by_label[k]["imageId"]}))
            for _, (pos, blk) in sorted(enumerate(inserts), key=lambda x: (-x[1][0], -x[0])):
                simple_out.insert(pos, blk)
            unplaced_simple = [fig_by_label[k]["imageId"] for k in fig_by_label if k not in splaced]
            # ranged headings
            for img in list(reversed(unplaced_simple)):
                f = next(x for x in ch_figs if x["imageId"] == img)
                heads = [i for i, b in enumerate(simple_out) if b["type"] == "heading"]
                target = None
                for hi, i in enumerate(heads):
                    pr = simple_out[i].get("pdfPages")
                    if pr and f["pdfPage"] and pr[0] <= f["pdfPage"] <= pr[1]:
                        target = heads[hi + 1] if hi + 1 < len(heads) else len(simple_out)
                        break
                if target is not None:
                    simple_out.insert(target, {"type": "figure", "imageId": img, "placement": "by_page_range"})
                    unplaced_simple.remove(img)
            simple = simple_out
            for i, b in enumerate(simple):
                if b["type"] == "heading":
                    b["id"] = f"{sid}-s-{i}-{slug(b['text'])}"
            for i, b in enumerate(full):
                b.setdefault("bid", f"{sid}-f{i}")
            for i, b in enumerate(simple):
                b.setdefault("bid", f"{sid}-u{i}")

            # glossary: bold Uzbek terms from the summary (+ parenthetical original names)
            terms = []
            seen = set()
            for b in simple:
                txt = block_plain(b)
                for m in re.finditer(r"\*\*([^*]{2,80}?)\*\*(\s*\(([^)]{2,80})\))?", txt):
                    term = m.group(1).strip().strip(":").strip()
                    if (not term or term.lower() in seen or re.fullmatch(r"[\d\s.,–-]+", term)
                            or re.search(r"\d+\s*[-–]\s*(bob|boblar)\b", term, re.I) or len(term) > 70):
                        continue
                    seen.add(term.lower())
                    # context sentence
                    start = max(0, txt.rfind(".", 0, m.start()) + 1)
                    end = txt.find(".", m.end())
                    ctx = txt[start:(end + 1) if end != -1 else len(txt)].strip()
                    terms.append({
                        "id": f"{sid}-t-{slug(term)}",
                        "termUz": term,
                        "original": (m.group(3) or None),
                        "contextUz": ctx[:400].replace("**", ""),
                        "lessonId": sid, "topicId": topic["id"],
                        "source": "summaryUz", "reviewStatus": "needs_review",
                    })
            book_defs = [{"pdfPage": d["pdfPage"], "printedPage": str(d["pdfPage"] - PAGE_OFFSET), "text": d["text"]} for d in defs]
            for t in terms:
                glossary.append(t)

            n_words_full = sum(len(block_plain(b).split()) for b in full if b["type"] in ("paragraph",))
            est = max(5, round(n_words_full / 200))
            figs_inc = sum(1 for f in ch_figs if f["coverage"] == "included")
            lesson = {
                "id": sid, "topicId": topic["id"], "order": order,
                "titleUz": title_uz_clean, "titleOriginal": L.norm(ch["title"]),
                "subtitle": subtitle,
                "contentVersion": CONTENT_VERSION,
                "status": "in_review",
                "translationStatus": "machine_assisted" if has_sum else "missing",
                "source": {
                    "bookId": BOOK_ID, "chapter": n, "unit": unit["roman"],
                    "pdfPages": [ch["pdfStart"], ch["pdfEnd"]],
                    "printedPages": [ch["pdfStart"] - PAGE_OFFSET, ch["pdfEnd"] - PAGE_OFFSET],
                    "notesFile": f"guyton-notes/{ch['file']}",
                    "summaryFile": f"guyton-notes/summaries/ch{n:02d}.md" if has_sum else None,
                },
                "pdfPages": [ch["pdfStart"], ch["pdfEnd"]],
                "printedPages": [ch["pdfStart"] - PAGE_OFFSET, ch["pdfEnd"] - PAGE_OFFSET],
                "outline": [dict(o, printedPage=str(o["pdfPage"] - PAGE_OFFSET), id=f"{sid}-h-{slug(o['title'])}") for o in outline],
                "objectives": [re.sub(r"\s*\(p\..*?\)\s*$", "", b["text"]).strip() for b in simple if b["type"] == "heading" and b["level"] == 2 and not re.match(r"^(Asosiy g|Bog'liqlik|Bog’liqlik|Klinik)", b["text"])],
                "blocks": {"simple": simple, "full": full},
                "glossary": terms,
                "bookDefinitions": book_defs,
                "keyNumbers": [{"pdfPage": x["pdfPage"], "printedPage": str(x["pdfPage"] - PAGE_OFFSET), "text": x["text"]} for x in nums],
                "figureIds": [f["imageId"] for f in ch_figs],
                "estMinutes": est,
                "counts": {"figures": len(ch_figs), "figuresIncluded": figs_inc, "terms": len(terms),
                           "words": n_words_full, "unplacedInSummary": len(unplaced_simple)},
                "review": {"reviewedBy": None, "reviewedAt": None},
                "importedAt": now,
            }
            # keep the old LessonVersion if content is byte-identical (idempotent re-import)
            lp = os.path.join(out, "lessons", f"{sid}.json")
            if os.path.exists(lp):
                old = json.load(open(lp, encoding="utf-8"))
                cmp_new = dict(lesson, importedAt=None)
                cmp_old = dict(old, importedAt=None)
                if json.dumps(cmp_new, sort_keys=True) == json.dumps(cmp_old, sort_keys=True):
                    lesson["importedAt"] = old["importedAt"]
            with open(lp, "w", encoding="utf-8") as fh:
                json.dump(lesson, fh, ensure_ascii=False, indent=1)
            topic["sections"].append({k: lesson[k] for k in ("id", "order", "titleUz", "titleOriginal", "pdfPages", "printedPages", "estMinutes", "status", "counts")})

            tcov["chapters"].append(n)
            tcov["sourceSections"]["expected"] += len(outline)
            tcov["sourceSections"]["found"] += sum(1 for o in outline if any(b["type"] == "heading" and norm_head(b["text"]) == norm_head(o["title"]) or (b.get("lead") and norm_head(b["lead"].rstrip(".")) == norm_head(o["title"])) for b in full))
            tcov["figures"]["expected"] += len(ch_figs)
            tcov["figures"]["included"] += figs_inc
            tcov["figures"]["needsReview"] += sum(1 for f in ch_figs if f["coverage"] == "needs_review")
            tcov["figures"]["missing"] += sum(1 for f in ch_figs if f["coverage"] == "missing")
            tcov["summaryUz"]["chapters"] += 1
            tcov["summaryUz"]["found"] += 1 if has_sum else 0
            for f in ch_figs:
                if f["coverage"] != "included":
                    tcov["missing"].append({"item": f["figureNumber"], "pdfPage": f["pdfPage"], "reason": "crop not found automatically" if f["coverage"] == "missing" else "full page fallback, needs manual crop"})
            if not has_sum:
                tcov["missing"].append({"item": f"Chapter {n} Uzbek summary", "reason": "summaries/chNN.md not found"})
            inventory.append({
                "topicId": topic["id"], "lessonId": sid, "book": BOOK_ID, "edition": "14", "chapter": n,
                "pdfPages": [ch["pdfStart"], ch["pdfEnd"]],
                "originalText": "found",
                "uzbekExplanation": "found" if has_sum else "missing",
                "uzbekExplanationKind": "study summary (Claude, earlier thread), not a full translation",
                "chapterIndex": "found",
                "figures": "found" if figs_inc == len(ch_figs) else "needs_review",
                "questions": "missing",
            })
        topics.append(topic)
        coverage.append(tcov)

    # write top-level files
    def dump(name, obj):
        with open(os.path.join(out, name), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, indent=1)

    if not only:
        dump("topics.json", {"contentVersion": CONTENT_VERSION, "topics": topics})
        dump("books.json", {"books": [book]})
        dump("aliases.json", {"sections": ALIASES, "note": "Old UI-package section IDs -> book-chapter lessons"})
        dump("glossary.json", {"contentVersion": CONTENT_VERSION, "terms": glossary})
        dump("inventory.json", {"generatedAt": now, "items": inventory})
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump({"contentVersion": CONTENT_VERSION, "bookEditionId": BOOK_ID, "figures": figures}, fh, ensure_ascii=False, indent=1)
        dump("coverage-report.json", {"generatedAt": now, "contentVersion": CONTENT_VERSION, "topics": coverage})
    print("topics", len(topics), "lessons", sum(len(t["sections"]) for t in topics), "figures", len(figures),
          "included", sum(1 for f in figures if f["coverage"] == "included"), "terms", len(glossary))


if __name__ == "__main__":
    main()
