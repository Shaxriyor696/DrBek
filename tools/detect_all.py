import sys, json, time
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pymupdf, pdf_layout as L
pdf, out = sys.argv[1], sys.argv[2]
d = pymupdf.open(pdf)
res = []
t = time.time()
for pno in range(7, 1026):
    for f in L.figure_regions(d[pno]):
        f["page"] = pno + 1
        res.append(f)
json.dump(res, open(out, "w"))
print(len(res), "captions", sum(1 for r in res if r["bbox"]), "with bbox", round(time.time() - t), "s")
