# -*- coding: utf-8 -*-
"""Build a clean, presentation-ready gaps summary PDF."""
import re, markdown
from xhtml2pdf import pisa

ACCENT = "#9b72f5"
SRC, OUT = "MEETING_GAPS_SUMMARY.md", "Simplix_Gaps_Summary.pdf"

EMOJI = {"—": " - ", "–": "-", "·": "|", "’": "'", "“": '"', "”": '"', "…": "..."}
def clean(t):
    for k, v in EMOJI.items(): t = t.replace(k, v)
    return re.sub("[\U0001F000-\U0001FAFF\U00002600-\U000027BF]", "", t)

CSS = f"""
@page {{ size: A4; margin: 1.6cm 1.7cm;
         @frame footer {{ -pdf-frame-content: footerContent; bottom: 0.8cm; height: 0.8cm; }} }}
body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #20242e; line-height: 1.5; }}
h1 {{ font-size: 21pt; color: {ACCENT}; margin: 0 0 2pt; }}
h3 {{ font-size: 11pt; color: #555; font-weight: normal; margin: 0 0 8pt; font-style: italic; }}
h2 {{ font-size: 13.5pt; color: #ffffff; background: {ACCENT}; margin: 16pt 0 6pt;
      padding: 5pt 10pt; border-radius: 5pt; }}
ul {{ margin: 4pt 0 6pt 8pt; padding-left: 12pt; }}
li {{ margin: 4pt 0; }}
strong {{ color: #15121f; }}
hr {{ border: none; border-top: 1pt solid #e3dcf7; margin: 12pt 0; }}
em {{ color: #555; }}
p {{ margin: 4pt 0; }}
.cover {{ border-bottom: 3pt solid {ACCENT}; padding-bottom: 8pt; margin-bottom: 6pt; }}
"""

with open(SRC, encoding="utf-8") as f:
    html = markdown.Markdown(extensions=["sane_lists"]).convert(clean(f.read()))

footer = '<div id="footerContent" style="text-align:center; font-size:8pt; color:#999;">Simplix Workboard | Gaps Summary | Confidential | 2026-06-02 | Page <pdf:pagenumber></div>'
full = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{footer}{html}</body></html>"

with open(OUT, "wb") as f:
    res = pisa.CreatePDF(full, dest=f, encoding="utf-8")
print("ERROR" if res.err else f"OK -> {OUT}")
