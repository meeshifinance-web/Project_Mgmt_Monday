# -*- coding: utf-8 -*-
"""Build a branded PDF from the live QA bug report."""
import re, markdown
from xhtml2pdf import pisa

ACCENT = "#9b72f5"
SRC = "BUG_REPORT.md"
OUT = "Simplix_Bug_Report.pdf"

EMOJI_MAP = {
    "🔴": "[CRITICAL]", "🟠": "[HIGH]", "🟡": "[MEDIUM]", "🟢": "[LOW]",
    "✅": "[PASS]", "→": "->", "—": " - ", "–": "-", "·": "|",
    "’": "'", "“": '"', "”": '"', "…": "...",
}
def clean(t):
    for k, v in EMOJI_MAP.items(): t = t.replace(k, v)
    return re.sub("[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]", "", t)

CSS = f"""
@page {{ size: A4; margin: 1.8cm 1.6cm;
         @frame footer {{ -pdf-frame-content: footerContent; bottom: 0.9cm; height: 0.9cm; }} }}
body {{ font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1f2333; line-height: 1.45; }}
h1 {{ font-size: 19pt; color: {ACCENT}; margin: 6pt 0 6pt; border-bottom: 2pt solid {ACCENT}; padding-bottom: 4pt; }}
h2 {{ font-size: 13pt; color: #2c2150; margin: 14pt 0 5pt; border-bottom: 1pt solid #ddd6f5; padding-bottom: 2pt; }}
h3 {{ font-size: 10.5pt; color: {ACCENT}; margin: 10pt 0 3pt; }}
p {{ margin: 3pt 0; }} ul, ol {{ margin: 3pt 0 3pt 14pt; }} li {{ margin: 2pt 0; }}
strong {{ color: #1a1530; }} em {{ color: #555; }}
code {{ font-family: Courier, monospace; background: #f3f0fb; font-size: 8.5pt; padding: 0 2pt; }}
table {{ width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: 8.2pt; }}
th {{ background: {ACCENT}; color: #fff; padding: 4pt 5pt; text-align: left; }}
td {{ padding: 3.5pt 5pt; border: 0.5pt solid #d8d2ee; vertical-align: top; }}
tr:nth-child(even) td {{ background: #f7f5fd; }}
hr {{ border: none; border-top: 0.5pt solid #ddd; margin: 8pt 0; }}
.cover {{ text-align: center; padding-top: 150pt; }}
.cover .brand {{ font-size: 32pt; color: {ACCENT}; font-weight: bold; }}
.cover .sub {{ font-size: 14pt; color: #2c2150; margin-top: 10pt; }}
.cover .tag {{ font-size: 10.5pt; color: #555; margin-top: 8pt; }}
.cover .meta {{ font-size: 9.5pt; color: #777; margin-top: 36pt; }}
.body {{ page-break-before: always; }}
"""

with open(SRC, "r", encoding="utf-8") as f:
    html = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"]).convert(clean(f.read()))

cover = f"""<div class="cover">
  <div class="brand">Simplix Workboard</div>
  <div class="sub">Detailed Bug Report - Live QA</div>
  <div class="tag">Reproduced against the running application across admin / manager / member / user roles</div>
  <div class="meta">Prepared 2026-06-02 | Confidential | Black-box + targeted source verification</div>
</div>"""

footer = '<div id="footerContent" style="text-align:center; font-size:8pt; color:#999;">Simplix Workboard | Bug Report | Confidential | Page <pdf:pagenumber> of <pdf:pagecount></div>'
full = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{footer}{cover}<div class='body'>{html}</div></body></html>"

with open(OUT, "wb") as f:
    res = pisa.CreatePDF(full, dest=f, encoding="utf-8")
print("ERROR" if res.err else f"OK -> {OUT}")
