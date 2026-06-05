# -*- coding: utf-8 -*-
"""Build a clean, professional slide-deck PDF for the Simplix meeting."""
from xhtml2pdf import pisa

ACCENT = "#9b72f5"
DARK = "#2c2150"
OUT = "Simplix_Meeting_Deck.pdf"

CSS = f"""
@page {{ size: A4 landscape; margin: 1.1cm 1.5cm 1.0cm; }}
body {{ font-family: Helvetica, Arial, sans-serif; color: #222733; font-size: 12pt; }}
.slide {{ page-break-after: always; }}
.kicker {{ font-size: 9.5pt; color: {ACCENT}; font-weight: bold; letter-spacing: 2pt; text-transform: uppercase; margin: 0 0 3pt; }}
h2 {{ font-size: 19pt; color: {DARK}; margin: 0 0 8pt; }}
ul {{ margin: 4pt 0 0 0; padding-left: 16pt; }}
li {{ font-size: 11pt; line-height: 1.32; margin: 3.5pt 0; color: #2b313d; }}
li b {{ color: {DARK}; }}
.muted {{ color: #6b7180; }}
.pill {{ background: {ACCENT}; color: #fff; font-size: 8.5pt; font-weight: bold; padding: 2pt 7pt; border-radius: 8pt; }}
.crit {{ background: #c0392b; }} .warn {{ background: #e08a1e; }} .ok {{ background: #1e8449; }}
table.cols {{ width: 100%; }} table.cols td {{ vertical-align: top; width: 50%; padding-right: 16pt; }}
.box {{ background: #f7f5fd; border-left: 3pt solid {ACCENT}; padding: 6pt 11pt; margin-top: 7pt; font-size: 11pt; }}
.big {{ font-size: 12.5pt; }}
.subh {{ font-size: 12.5pt; color: {DARK}; font-weight: bold; margin: 0 0 2pt; }}
table.cmp {{ width: 100%; border-collapse: collapse; margin-top: 6pt; font-size: 11pt; }}
table.cmp th {{ background: {ACCENT}; color: #fff; padding: 5pt 8pt; text-align: left; }}
table.cmp td {{ padding: 4.5pt 8pt; border: 0.5pt solid #ddd6f5; }}
table.cmp tr:nth-child(even) td {{ background: #faf8ff; }}
.foot {{ font-size: 8pt; color: #9aa0ad; border-top: 0.5pt solid #e3dcf7; padding-top: 4pt; margin-top: 14pt; }}
.foot .r {{ float: right; }}
.cover {{ background: {DARK}; color: #fff; padding: 2.4cm 0.5cm 0; height: 13.6cm; }}
.cover .brand {{ color: {ACCENT}; font-size: 13pt; font-weight: bold; letter-spacing: 3pt; }}
.cover h1 {{ color: #fff; font-size: 32pt; margin: 10pt 0 0; }}
.cover .sub {{ color: #d7ccff; font-size: 15pt; margin-top: 12pt; }}
.cover .meta {{ color: #a99ddb; font-size: 11pt; margin-top: 1.4cm; }}
"""

def slide(kicker, title, body, n, total=14):
    return f"""
    <div class="slide">
      <p class="kicker">{kicker}</p>
      <h2>{title}</h2>
      {body}
      <div class="foot">Simplix Workboard — Product Review &amp; Roadmap <span class="r">{n} / {total}</span></div>
    </div>"""

cover = f"""
<div class="slide"><div class="cover">
  <div class="brand">SIMPLIX WORKBOARD</div>
  <h1>Product Review &amp; Roadmap</h1>
  <div class="sub">Where we stand, what to fix, and how we beat Monday.com</div>
  <div class="meta">Team meeting &nbsp;|&nbsp; 2026-06-02 &nbsp;|&nbsp; Divyanshi Mishra &nbsp;|&nbsp; Confidential</div>
</div></div>"""

slides = []

# 2 — Executive snapshot
slides.append(slide("Executive snapshot", "A strong product, held back by a few fixable gaps", """
<ul>
<li><b>What's solid:</b> secure login (MFA + Microsoft SSO), 21 column types, a rich 40+ widget dashboard, automations that fire correctly, forms, trash &amp; recovery — verified by live testing.</li>
<li><b>What holds us back:</b> a few real bugs, no multiple board views, no cross-board links, shallow automations, and no AI yet.</li>
<li><b>The opportunity:</b> close the gaps to reach parity, then win on <b>AI-native</b> features and <b>BI-grade dashboards</b> where Monday is weak.</li>
</ul>
<div class="box big">Verdict: ~70% of the way to a commercial product. The remaining 30% is concentrated in a few high-leverage systems — a focused build, not a thousand small fixes.</div>
""", 2))

# 3 — Where to focus (priorities)
slides.append(slide("Our priorities", "What we focus on first", """
<table class="cols"><tr><td>
<ul>
<li><span class="pill crit">FIX NOW</span> &nbsp;3 critical bugs (security &amp; data loss)</li>
<li><span class="pill warn">QUICK WINS</span> &nbsp;Column system polish + customization menu</li>
<li><span class="pill warn">QUICK WINS</span> &nbsp;Templates gallery for professional use-cases</li>
<li><span class="pill warn">QUICK WINS</span> &nbsp;Dashboard reporting &amp; Activity / Audit center</li>
</ul>
</td><td>
<ul>
<li><span class="pill">BIG ROCKS</span> &nbsp;Automation engine rebuild</li>
<li><span class="pill">BIG ROCKS</span> &nbsp;Multiple views + connect-boards</li>
<li><span class="pill ok">LEAPFROG</span> &nbsp;AI builders (board / automation / formula)</li>
<li><span class="pill ok">LEAPFROG</span> &nbsp;Autofill columns with AI</li>
</ul>
</td></tr></table>
<div class="box">These are drawn from our review notes — the items that move the product the most for the least effort come first.</div>
""", 3))

# 4 — Critical bugs
slides.append(slide("Fix first", "3 critical bugs to fix before anything else", """
<ul>
<li><span class="pill crit">SECURITY</span> &nbsp;<b>Automations have no access control</b> — any manager can read, create, or delete automations on <i>any</i> board, even private ones they aren't part of.</li>
<li><span class="pill crit">DEAD FEATURE</span> &nbsp;<b>"Make Public" does nothing</b> — switching a board to Public changes nothing; others still can't see it.</li>
<li><span class="pill crit">DATA LOSS</span> &nbsp;<b>An automation can lose an item</b> — the "move to group" action can move a task into another board, making it disappear from where it belongs.</li>
</ul>
<div class="box">Also: no input validation (a Number field accepts text), the global search API errors out, and "My Work" status colours show grey. All small, contained fixes.</div>
""", 4))

# 5 — Column system
slides.append(slide("Quick wins", "Column system — finish the small things", """
<table class="cols"><tr><td>
<p class="big" style="color:#2c2150;font-weight:bold;">Fix the rough edges</p>
<ul>
<li><b>Make every cell clearable</b> — Link, Colour, Timeline, Checkbox can't be reset today.</li>
<li><b>Validate inputs</b> — Number, Date, Email, Phone (+ click-to-call / mailto).</li>
<li><b>Debounce saves</b> — Link/Progress/Colour save on every keystroke.</li>
</ul>
</td><td>
<p class="big" style="color:#2c2150;font-weight:bold;">Add the column menu (Monday-style)</p>
<ul>
<li>Customize status, <b>add description</b>, <b>restrict view</b>, hide summary</li>
<li><b>Filter, Sort, Group-by</b> from the column header</li>
<li>Duplicate column, add to the right, change type</li>
<li><span class="pill ok">AI</span> <b>Autofill column with AI</b></li>
</ul>
</td></tr></table>
""", 5))

# 6 — Automations
slides.append(slide("Big rock", "Automations — rebuild the engine", """
<table class="cols"><tr><td>
<p class="big" style="color:#2c2150;font-weight:bold;">Structural fixes</p>
<ul>
<li><b>Multiple actions per rule</b> ("set Done AND assign AND notify")</li>
<li><b>Conditions / "only if"</b> ("when Done IF priority = High")</li>
<li>Merge the two split engines into one builder</li>
<li><b>Run history</b> + surface failures (today they're silent)</li>
</ul>
</td><td>
<p class="big" style="color:#2c2150;font-weight:bold;">More triggers &amp; actions</p>
<ul>
<li>Scheduled / recurring ("every Monday 9am", "3 days before due")</li>
<li>Fix <b>Notify</b> — let it reach a chosen person</li>
<li><b>Set any column</b>, create sub-item, cross-board create</li>
<li>Webhook / Slack / Teams; subitem triggers</li>
</ul>
</td></tr></table>
""", 6))

# 7 — Dashboards
slides.append(slide("Quick win", "Dashboards — make reporting real", """
<ul>
<li><b>Click-through charts</b> — click a bar/slice to see the items behind it (only lists do this today).</li>
<li><b>Cross-board rollups</b> — one KPI that sums across multiple boards; a real people-picker for the person filter.</li>
<li><b>Auto-refresh</b> — dashboards are a frozen snapshot until you reload.</li>
<li><b>Scheduled delivery</b> — email / Slack a dashboard snapshot every Monday.</li>
<li><b>Historical data</b> — record changes over time so Burndown &amp; velocity become real (today they can't).</li>
</ul>
<div class="box">Our 40+ widget library already beats Monday's defaults — these four upgrades make it the best dashboard in the category.</div>
""", 7))

# 8 — Forms + Activity/Audit
slides.append(slide("Quick wins", "Forms polish &amp; Activity / Audit center", """
<table class="cols"><tr><td>
<p class="big" style="color:#2c2150;font-weight:bold;">Forms</p>
<ul>
<li>Scheduled open/close &amp; response limits</li>
<li>Conditional logic, file upload, CAPTCHA</li>
<li>Confirmation email + custom "closed" message</li>
<li>Make the Active toggle save instantly</li>
</ul>
</td><td>
<p class="big" style="color:#2c2150;font-weight:bold;">Activity log &amp; Audit center</p>
<ul>
<li><b>Log automation- &amp; form-driven changes</b> (the big gap today)</li>
<li>Filter by person / date / action; full history + export</li>
<li><b>Admin "audit center"</b> — cross-board activity, per-user drill-down ("everything this person did")</li>
</ul>
</td></tr></table>
""", 8))

# 9 — Templates
slides.append(slide("Quick win", "Templates — kill the blank page", """
<ul>
<li><b>Built-in template gallery</b> for professional use-cases: CRM, sprints, content calendar, hiring, OKRs, client projects.</li>
<li>Every new board starts blank today — templates teach the product <i>and</i> deliver value in 30 seconds.</li>
<li>Biggest lever for <b>activation</b> (new users) and <b>virality</b> (shareable templates).</li>
<li>Low effort — we already have board-cloning plumbing to build on.</li>
</ul>
<div class="box big">Monday ships 200+ templates as its #1 onboarding path. Even 10 strong ones close most of the gap.</div>
""", 9))

# 10 — AI builders
slides.append(slide("The leapfrog", "AI builders — where we beat Monday", """
<ul>
<li><b>NL &rarr; Board</b> — "a content calendar with status, owner, due date and a publish checklist" &rarr; a working board. Kills the blank page; highly demo-able. <span class="muted">(Effort: Low–Med)</span></li>
<li><b>NL &rarr; Automation</b> — describe a rule in English &rarr; it builds the recipe against real columns. <span class="muted">(Effort: Med)</span></li>
<li><b>NL &rarr; Formula</b> — "days between start and end, excluding weekends" &rarr; a valid formula. <span class="muted">(Effort: Low)</span></li>
<li><b>AI column</b> — summarize / classify / extract per row (the "Autofill with AI" menu item).</li>
</ul>
<div class="box big">Monday's AI is bolt-on. An AI-native Simplix — generate, automate, and query in plain English — is a genuine category move.</div>
""", 10))

# 11 — Missing vs Monday
slides.append(slide("Parity gaps", "What Monday still does better", """
<table class="cmp">
<tr><th width="34%">Capability</th><th width="22%">Simplix</th><th>Why it matters</th></tr>
<tr><td>Multiple views (Kanban / Calendar / Gantt)</td><td>Table only</td><td>See the same data many ways</td></tr>
<tr><td>Connect boards + Mirror + Rollup</td><td>None</td><td>One connected system, not islands</td></tr>
<tr><td>Real-time collaboration</td><td>None</td><td>Live edits &amp; presence</td></tr>
<tr><td>Integrations (Slack/Teams/Gmail/Zapier)</td><td>None</td><td>Fits into existing workflows</td></tr>
<tr><td>Task dependencies + critical path</td><td>None</td><td>Real project management</td></tr>
<tr><td>Native mobile apps</td><td>Web/PWA only</td><td>Field &amp; on-the-go use</td></tr>
</table>
""", 11))

# 12 — Roadmap
slides.append(slide("The plan", "Roadmap in 3 phases", """
<table class="cmp">
<tr><th width="16%">Phase</th><th width="44%">Focus</th><th>Outcome</th></tr>
<tr><td><b>1. Real product</b></td><td>Fix critical bugs &middot; column polish + menu &middot; templates &middot; dashboard reporting &middot; audit center</td><td>Stops churn; feels complete</td></tr>
<tr><td><b>2. Parity</b></td><td>Multiple views &middot; connect/mirror/rollup &middot; automation rebuild &middot; real-time &middot; integrations</td><td>Teams &amp; enterprises can adopt</td></tr>
<tr><td><b>3. Surpass</b></td><td>AI builders &middot; AI columns &middot; ask-your-workspace &middot; cross-board BI &middot; templates marketplace</td><td>An AI-native work OS Monday can't match</td></tr>
</table>
<div class="box big">One-line strategy: ship the views, templates &amp; fixes to stop churn &rarr; add the connected + real-time layers to reach parity &rarr; go all-in on AI to win.</div>
""", 12))

# 13 — Next steps / the ask
slides.append(slide("Decision", "What we need from this meeting", """
<ul>
<li><b>Agree the Phase-1 list</b> — critical bug fixes, column polish + menu, templates, dashboard reporting, audit center.</li>
<li><b>Green-light the AI builders</b> as our differentiator — start with NL &rarr; Formula (safest), then NL &rarr; Board.</li>
<li><b>Decide ownership &amp; timeline</b> for the automation-engine rebuild (the biggest enabler).</li>
<li><b>Confirm budget</b> for an AI API key + per-workspace usage limits.</li>
</ul>
<div class="box big">Recommended first sprint: the 3 critical bug fixes + 10 starter templates + the column "clear &amp; validate" pass — visible wins within two weeks.</div>
""", 13))

# Closing
closing = f"""
<div class="slide"><div class="cover">
  <div class="brand">SIMPLIX WORKBOARD</div>
  <h1>Let's build the best<br/>work OS in the market.</h1>
  <div class="sub">Reach parity. Win on AI.</div>
  <div class="meta">Thank you &nbsp;|&nbsp; Questions &amp; discussion</div>
</div></div>"""

html = f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{cover}{''.join(slides)}{closing}</body></html>"
with open(OUT, "wb") as f:
    res = pisa.CreatePDF(html, dest=f, encoding="utf-8")
print("ERROR" if res.err else f"OK -> {OUT}")
