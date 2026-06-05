# -*- coding: utf-8 -*-
"""Build a tight 2-page executive summary PDF for stakeholders."""
from xhtml2pdf import pisa

ACCENT = "#9b72f5"

CSS = f"""
@page {{ size: A4; margin: 1.4cm 1.5cm 1.2cm 1.5cm;
         @frame footer {{ -pdf-frame-content: footerContent; bottom: 0.6cm; height: 0.8cm; }} }}
body {{ font-family: Helvetica, Arial, sans-serif; font-size: 8.6pt; color: #1f2333; line-height: 1.32; }}
.title {{ font-size: 17pt; color: {ACCENT}; font-weight: bold; margin: 0; }}
.subtitle {{ font-size: 9pt; color: #555; margin: 2pt 0 6pt; }}
.rule {{ border-top: 2pt solid {ACCENT}; margin: 4pt 0 8pt; }}
h2 {{ font-size: 10.5pt; color: #2c2150; margin: 9pt 0 3pt; border-bottom: 0.75pt solid #ddd6f5; padding-bottom: 2pt; }}
p {{ margin: 3pt 0; }}
ul {{ margin: 2pt 0 2pt 13pt; }}
li {{ margin: 1.5pt 0; }}
strong {{ color: #1a1530; }}
table {{ width: 100%; border-collapse: collapse; margin: 4pt 0; font-size: 8pt; }}
th {{ background: {ACCENT}; color: #fff; padding: 3.5pt 5pt; text-align: left; }}
td {{ padding: 3pt 5pt; border: 0.5pt solid #d8d2ee; vertical-align: top; }}
tr:nth-child(even) td {{ background: #f7f5fd; }}
.two {{ width: 100%; }}
.two td {{ border: none; vertical-align: top; padding: 0 8pt 0 0; width: 50%; }}
.badge {{ font-weight: bold; }}
.crit {{ color: #c0392b; }} .ok {{ color: #1e8449; }}
.box {{ background: #faf8ff; border: 0.5pt solid #e3dcf7; border-radius: 4pt; padding: 5pt 8pt; margin: 4pt 0; }}
.kpi {{ font-size: 13pt; color: {ACCENT}; font-weight: bold; }}
"""

HTML = f"""
<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>
<div id="footerContent" style="text-align:center; font-size:7pt; color:#999;">Simplix Workboard | Executive Summary | Confidential | 2026-06-02 | Page <pdf:pagenumber> of <pdf:pagecount></div>

<div class="title">Simplix Workboard - Executive Summary</div>
<div class="subtitle">Product &amp; UX strategy at a glance, benchmarked against Monday.com</div>
<div class="rule"></div>

<table class="two"><tr><td>
<p><strong>The verdict.</strong> A 70%-built Monday.com alternative with two standout assets - a
<strong>40+ widget dashboard engine</strong> (better than Monday's) and high-craft
<strong>cell editing</strong> - on a <strong>near-enterprise security layer</strong> (MFA, SSO, confidential boards).
Three structural gaps hold it back: it is <strong>single-view</strong>, <strong>non-relational</strong>,
and its <strong>automation is shallow and split in two</strong>. The missing ~45% is concentrated in a
few high-leverage systems, and the hard foundations are already built - so the gap is closeable.</p>
</td><td>
<div class="box">
<div class="kpi">~4.6 / 8.4</div>
<div style="font-size:8pt;color:#555;">Weighted product score vs Monday.com (~55% of surface).
You <span class="ok badge">win on dashboards</span>; you lose hardest on views, relational data,
automation, integrations, and AI.</div>
</div>
</td></tr></table>

<h2>The 3 problems that define everything</h2>
<ul>
<li><strong><span class="crit">Single-view.</span></strong> Boards render only as a <strong>Table</strong>. Kanban is built but not wired in; no Calendar / Gantt / Chart / Workload. The view tabs imply multiple views - a false promise that erodes trust fast.</li>
<li><strong><span class="crit">Not relational.</span></strong> No <strong>connect-boards / mirror / rollup</strong>. Teams re-key data across boards, lose a single source of truth, and revert to spreadsheets. This caps team scale.</li>
<li><strong><span class="crit">Shallow, split automation.</span></strong> Single-condition only, <strong>no scheduling/recurrence</strong>, <strong>two separate engines</strong>, no run history. Users can't tell a rule fired, lose confidence, and abandon the stickiest feature.</li>
</ul>

<table class="two"><tr><td>
<h2>Core strengths (keep &amp; extend)</h2>
<ul>
<li><strong>Dashboards</strong> - 40+ widgets, drag grid; a real wedge ("BI built in").</li>
<li><strong>Cell UX</strong> - status pills, multi-select, avatar people-picker, file uploads with progress, resizable long-text.</li>
<li><strong>Security/account</strong> - MFA, Microsoft SSO, RBAC, per-board confidential visibility.</li>
<li><strong>Niceties</strong> - Cmd-K palette, folders, trash+retention, clone, CSV import, inbound email-to-item, PWA, dark mode.</li>
</ul>
</td><td>
<h2>Core weaknesses (fix to compete)</h2>
<ul>
<li>Table-only views; <strong>no real-time</strong> collaboration.</li>
<li><strong>No templates</strong> - blank-board paralysis kills activation.</li>
<li><strong>No integrations / webhooks</strong> - it's an island.</li>
<li><strong>No AI</strong> - the single biggest leap available in 2026.</li>
<li>Flat data model users feel: no number summaries, timeline is text, time-tracking is a textbox, formulas are display-only.</li>
<li>No workspace tier; mobile is a shrunk desktop table.</li>
</ul>
</td></tr></table>

<h2>Where to win (don't just chase parity)</h2>
<p><strong>AI is greenfield (score 0) - your leapfrog.</strong> An <strong>NL board generator</strong> ("build a content calendar with status, owner, due date") kills the empty state and is highly demo-able/viral; an <strong>NL automation builder</strong> fixes the no-code-logic gap directly; an <strong>AI column</strong> (summarize / classify / extract per row) turns boards into intelligence pipelines; <strong>ask-your-board</strong> gives execs answers without dashboards. Monday's AI is bolt-on - an AI-native Simplix is a genuine category move.</p>

<div style="page-break-before: always;"></div>

<h2>Build next (ranked by impact)</h2>
<table>
<tr><th width="4%">#</th><th width="30%">Initiative</th><th width="44%">Why it matters</th><th width="22%">Effort / Priority</th></tr>
<tr><td>1</td><td>Multi-view (wire Kanban -&gt; Calendar -&gt; Gantt)</td><td>Removes the #1 "it's just a list" objection. Kanban code already exists.</td><td>Medium | <span class="crit badge">Critical</span></td></tr>
<tr><td>2</td><td>Templates + activation flow</td><td>Fastest path to activation, retention, and viral sharing.</td><td>Low-Med | <span class="crit badge">Critical</span></td></tr>
<tr><td>3</td><td>Unified automation builder + scheduling + run history</td><td>The no-code core: multi-condition, multi-action, recurring, visible runs.</td><td>High | <span class="crit badge">Critical</span></td></tr>
<tr><td>4</td><td>Connect / Mirror / Rollup columns</td><td>Relational lock-in; unlocks portfolios, CRM, dependencies. Data gravity = retention.</td><td>High | <span class="crit badge">Critical</span></td></tr>
<tr><td>5</td><td>AI board generator + NL automation + AI column</td><td>The leapfrog past Monday; virality + daily-active hooks.</td><td>High | High</td></tr>
<tr><td>6</td><td>Real-time sync + Updates feed</td><td>Turns single-player into multiplayer; the "live workspace" feel.</td><td>Med-High | High</td></tr>
<tr><td>7</td><td>Integrations + webhooks (Slack/Teams/Gmail/Calendar)</td><td>Removes adoption friction; creates network effects.</td><td>Medium | High</td></tr>
<tr><td>8</td><td>Cross-board dashboards + filter + drill-through + scheduled delivery</td><td>Extends your strongest asset into a true marketing wedge.</td><td>Medium | High</td></tr>
</table>

<h2>Quick wins (days, high felt value)</h2>
<ul>
<li>Wire up the existing <strong>Kanban view</strong>.</li>
<li><strong>Group-by-column + multi-sort + real filter operators</strong> (between / empty / before / after).</li>
<li><strong>Number column summaries</strong> (sum / avg / min / max in group footer) + currency / % formatting.</li>
<li><strong>Conditional formatting v1</strong> (overdue rows red) + <strong>freeze the item-name column</strong>.</li>
<li>A handful of <strong>starter templates</strong> on the empty state.</li>
<li><strong>Notification preferences + digest</strong>; surface automation/email failures in the UI.</li>
<li><strong>Priority column icons</strong> (currently empty) + overdue date styling.</li>
</ul>

<h2>Roadmap to surpass Monday.com</h2>
<table>
<tr><th width="14%">Phase</th><th width="40%">Focus</th><th width="46%">Outcome</th></tr>
<tr><td><strong>1. Real product</strong></td><td>Multi-view, templates + activation, table power (group-by / multi-sort / filters / number summaries), notification controls.</td><td>Stops churn at activation and the "it's just a list" objection.</td></tr>
<tr><td><strong>2. Parity</strong></td><td>Connect/mirror/rollup + dependencies, unified automation + scheduling, real-time + Updates feed, integrations + webhooks, workspaces + enterprise admin (SAML/SCIM/audit).</td><td>Enterprises can adopt; teams scale on it.</td></tr>
<tr><td><strong>3. Surpass</strong></td><td>AI board generator, NL automation, AI columns, ask-your-board, autonomous agents, cross-board BI, composable views, template + integration marketplace.</td><td>An AI-native work OS that does what Monday structurally can't.</td></tr>
</table>

<div class="box" style="margin-top:8pt;">
<strong>One-sentence strategy.</strong> Ship the views you've half-built and the templates you lack to stop churn,
add the relational + automation + real-time layers to reach parity, then go all-in on AI-native generation
and querying to win.
</div>

</body></html>
"""

out = "Simplix_Executive_Summary.pdf"
with open(out, "wb") as f:
    result = pisa.CreatePDF(HTML, dest=f, encoding="utf-8")
print("ERROR" if result.err else f"OK -> {out}")
