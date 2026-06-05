# -*- coding: utf-8 -*-
"""Build a single branded PDF from the three Simplix analysis reports."""
import re
import markdown
from xhtml2pdf import pisa

ACCENT = "#9b72f5"

SOURCES = [
    ("STRATEGIC_PRODUCT_REPORT.md",  "Part I - Strategic Product Report vs. Monday.com"),
    ("FEATURE_TEST_MATRIX.md",       "Part II - Full Feature Test Matrix & Gap Report (live-tested)"),
    ("FEATURE_PERFECTION_STANDARD.md","Part III - Feature Perfection Standard (build spec)"),
    ("FEATURE_ANALYSIS_REPORT.md",   "Part IV - Feature Analysis & Enhancement Report"),
    ("BUG_REPORT.md",                "Part V - Detailed Bug Report (live QA)"),
    ("PRODUCT_AUDIT_REPORT.md",      "Part VI - Product & Engineering Audit"),
]

# Map severity / marker emoji to clean text badges; strip the rest.
EMOJI_MAP = {
    "🔴": "[CRITICAL]", "🟠": "[HIGH]", "🟡": "[MEDIUM]", "🟢": "[OK]",
    "🔵": "", "🔮": "[FUTURE]", "→": "->", "↑": "^", "↓": "v",
    "✅": "[done]", "⚡": "", "★": "*", "☆": "*",
    "—": " - ", "–": "-", "·": "|", "’": "'", "“": '"', "”": '"', "…": "...",
}

def clean_emoji(text):
    for k, v in EMOJI_MAP.items():
        text = text.replace(k, v)
    # Strip any remaining non-latin pictographs / symbols that fonts can't render
    text = re.sub(
        "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF←-⇿⌀-⏿⬀-⯿️]",
        "", text)
    return text

CSS = f"""
@page {{ size: A4; margin: 2cm 1.8cm 2cm 1.8cm;
         @frame footer {{ -pdf-frame-content: footerContent; bottom: 1cm; height: 1cm; }} }}
body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #1f2333; line-height: 1.5; }}
h1 {{ font-size: 20pt; color: {ACCENT}; margin: 18pt 0 8pt; border-bottom: 2pt solid {ACCENT}; padding-bottom: 4pt; }}
h2 {{ font-size: 14pt; color: #2c2150; margin: 16pt 0 6pt; border-bottom: 1pt solid #ddd6f5; padding-bottom: 2pt; }}
h3 {{ font-size: 11.5pt; color: {ACCENT}; margin: 12pt 0 4pt; }}
p {{ margin: 4pt 0; }}
ul, ol {{ margin: 4pt 0 4pt 14pt; }}
li {{ margin: 2pt 0; }}
strong {{ color: #1a1530; }}
em {{ color: #444; }}
code {{ font-family: Courier, monospace; background: #f3f0fb; font-size: 9pt; padding: 0 2pt; }}
table {{ -pdf-keep-in-frame-mode: shrink; width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 8.5pt; }}
th {{ background: {ACCENT}; color: #fff; padding: 5pt 6pt; text-align: left; border: 0.5pt solid {ACCENT}; }}
td {{ padding: 4pt 6pt; border: 0.5pt solid #d8d2ee; vertical-align: top; }}
tr:nth-child(even) td {{ background: #f7f5fd; }}
blockquote {{ color: #555; border-left: 3pt solid {ACCENT}; margin: 6pt 0; padding: 2pt 0 2pt 10pt; background: #faf8ff; }}
hr {{ border: none; border-top: 0.5pt solid #ddd; margin: 10pt 0; }}
.cover {{ text-align: center; padding-top: 150pt; }}
.cover .brand {{ font-size: 34pt; color: {ACCENT}; font-weight: bold; }}
.cover .sub {{ font-size: 15pt; color: #2c2150; margin-top: 12pt; }}
.cover .meta {{ font-size: 10pt; color: #777; margin-top: 40pt; }}
.cover .tag {{ font-size: 11pt; color: #555; margin-top: 8pt; }}
.part {{ -pdf-keep-with-next: true; page-break-before: always; }}
"""

md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists", "nl2br"])

cover = f"""
<div class="cover">
  <div class="brand">Simplix Workboard</div>
  <div class="sub">Complete Product, Feature &amp; QA Report</div>
  <div class="tag">A no-code work-OS analysis benchmarked against Monday.com, with live feature testing</div>
  <div class="meta">Prepared 2026-06-02 | Confidential | 6-part consolidated deliverable</div>
</div>
"""

# Contents page
toc_rows = "".join(
    f'<tr><td style="width:14%;color:{ACCENT};font-weight:bold;">{t.split(" - ")[0]}</td>'
    f'<td>{t.split(" - ",1)[1]}</td></tr>'
    for _, t in SOURCES
)
contents = f"""
<div class="part">
  <h1>Contents</h1>
  <p style="color:#555;">This consolidated report integrates all six analyses into a single document.</p>
  <table>{toc_rows}</table>
  <p style="margin-top:14pt;font-size:8.5pt;color:#777;">
    Parts I-IV are product/feature/UX strategy and the world-class build spec. Part II is grounded in
    live testing of the running application. Parts V-VI cover confirmed bugs and the engineering audit.
  </p>
</div>
"""

body_html = [cover, contents]
for path, part_title in SOURCES:
    with open(path, "r", encoding="utf-8") as f:
        raw = clean_emoji(f.read())
    md.reset()
    html = md.convert(raw)
    body_html.append(f'<div class="part"><div style="font-size:9pt;color:{ACCENT};letter-spacing:1pt;text-transform:uppercase;">{part_title}</div></div>')
    body_html.append(html)

footer = f'<div id="footerContent" style="text-align:center; font-size:8pt; color:#999;">Simplix Workboard | Complete Product &amp; Feature Report | Confidential | Page <pdf:pagenumber> of <pdf:pagecount></div>'

full = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{footer}{''.join(body_html)}</body></html>"

out = "Simplix_Complete_Product_Report.pdf"
with open(out, "wb") as f:
    result = pisa.CreatePDF(full, dest=f, encoding="utf-8")

print("ERROR" if result.err else f"OK -> {out}")
