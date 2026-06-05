# -*- coding: utf-8 -*-
"""Professional black & white report: bugs, per-column issues, new features, AI."""
from xhtml2pdf import pisa

OUT = "Simplix_Technical_Report.pdf"

CSS = """
@page { size: A4; margin: 1.5cm 1.6cm 1.4cm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #000; line-height: 1.4; }
h1 { font-size: 22pt; color: #000; margin: 0 0 2pt; }
.sub { font-size: 10pt; color: #444; margin: 0 0 4pt; }
h2 { font-size: 14pt; color: #000; margin: 16pt 0 5pt; border-bottom: 1.5pt solid #000; padding-bottom: 3pt; }
h3 { font-size: 11pt; color: #000; margin: 11pt 0 3pt; }
h4 { font-size: 9.8pt; color: #000; margin: 8pt 0 2pt; text-decoration: underline; }
ul { margin: 2pt 0 4pt 2pt; padding-left: 14pt; }
li { margin: 2pt 0; font-size: 9.3pt; }
b { color: #000; }
.lead { font-size: 9.5pt; color: #333; }
hr { border: none; border-top: 0.5pt solid #999; margin: 8pt 0; }
table { width: 100%; border-collapse: collapse; margin: 5pt 0; font-size: 9pt; }
th { background: #1a1a1a; color: #fff; padding: 4pt 7pt; text-align: left; }
td { padding: 4pt 7pt; border: 0.5pt solid #bbb; vertical-align: top; }
tr:nth-child(even) td { background: #f2f2f2; }
.tag { font-family: Helvetica; font-weight: bold; font-size: 8pt; border: 1pt solid #000; padding: 1pt 5pt; }
.cover { text-align: left; border-bottom: 3pt solid #000; padding-bottom: 10pt; margin-bottom: 8pt; }
.toc { font-size: 9.5pt; }
.toc td { border: none; padding: 3pt 0; }
.sec { page-break-before: always; }
"""

# ---------- COLUMN TYPE ISSUES TABLE ----------
col_rows = [
 ("Status / Priority", "\"Auto-assign labels\" footer is a dead button. No search in the options list. Editing labels: no reorder, no duplicate-name check, no per-label icon. Priority has no icons."),
 ("Dropdown", "Stores a single value as a JSON array. Editing options: no reorder, no duplicate check. Can't create an option from the search box. Chips truncate at ~100px."),
 ("Rating", "Fixed at 5 stars (not configurable). Accepts out-of-range values via API (e.g. 999). No half-stars. No tooltip."),
 ("Progress", "No clamping — 5000% breaks the row layout; negatives accepted. Saves on every keystroke (no debounce). No explicit clear option."),
 ("Checkbox", "Can never return to empty/unset — once touched it is permanently true/false; no third blank state, so it can't be cleared."),
 ("Tags", "All tags render the same colour. Comma-separated free text — a comma inside a tag breaks it; no shared vocabulary, no autocomplete, no dedup. Clearing is not obvious (delete all text)."),
 ("Timeline (date range)", "Cannot be cleared — clearing both dates stores \" -> \", not empty; no clear button. Stored as the string \"start -> end\" so it can't sort/filter by date or drive a Gantt/calendar. One-sided ranges are malformed. No validation that end >= start; no duration. Saves on every change."),
 ("Link", "Single-click opens the URL, so edit/clear is unreachable; no clear button. Saves on every keystroke. No validation — links without http:// become broken in-app relative links. javascript: URLs are a stored-XSS risk. No separate display label; truncates the end of the URL."),
 ("Number", "Accepts text / NaN / Infinity. No number formatting (currency, %, decimals, separators). No column summary (sum/avg) in the group/board footer."),
 ("Email", "No real validation. No mailto: click action."),
 ("Phone", "No validation. No click-to-call."),
 ("Time tracking", "Just a text box — no start/stop timer, no accumulation, no timesheets, no billing."),
 ("Creation log","Shows only \"created by / at\" — no companion \"last updated by / at\". Timezone uses the browser's local hours while the rest of the app is pinned to IST, so the time can differ."),
 ("People / Person", "Assignment is stored by name string, not user ID — duplicate names collide and renaming a user breaks their existing assignments. Members can't self-assign (read-only for non-managers). Initials only (ignores users' avatar photos). Many assignees get clipped with no \"+N more\". Search only appears with >6 members."),
 ("Files", "No drag-and-drop onto the cell. No image thumbnails (icon only). No rename / versioning. 20 MB cap. Any logged-in user can fetch any file by guessing its name. A failed delete is silent."),
 ("Formula", "Display-only — not stored, so it can't be sorted, filtered, exported as a value, or used in automations/dashboards. Recomputes on every render. POWER overflow misreported (#DIV/0! instead of #NUM!). Formula only visible on hover."),
]

col_table = "".join(f"<tr><td style='width:24%'><b>{t}</b></td><td>{d}</td></tr>" for t, d in col_rows)

HTML = f"""
<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>
<h1 style="margin-bottom:8pt;">Simplix Workboard — Technical Report</h1>

<h2>1. Bugs &amp; Issues</h2>

<h3>1.1 Critical</h3>
<ul>
<li><b>Automations have no access control (IDOR)</b> — any manager can read, create, or delete automations on any board, including private ones they aren't a member of.</li>
<li><b>"Make Public" does nothing</b> — visibility flag is ignored; public boards stay inaccessible to non-members.</li>
<li><b>"Move to group" automation can lose an item</b> — it can move a task into another board, where it disappears from its origin (no same-board check).</li>
</ul>

<h3>1.2 High / Data integrity</h3>
<ul>
<li><b>No input validation</b> on any field — Number stores "banana"/NaN/Infinity, Date stores impossible dates, Email/Rating/Progress accept garbage.</li>
<li><b>Kanban view never renders</b> — built but not wired into the board; table-only in practice.</li>
<li><b>"My Work" status colours show grey</b> — reads the wrong settings key.</li>
<li><b>No real-time</b> — concurrent edits are last-write-wins and silently overwrite.</li>
</ul>

<h3>1.3 Medium / Low</h3>
<ul>
<li>Global search API (/api/search) returns 500 (broken query) — not UI-wired.</li>
<li>Empty board / item names accepted; arbitrary column type accepted.</li>
<li>&lt;script&gt; payloads stored verbatim (stored-XSS risk in exports / emails).</li>
<li>No length caps on cell values or comments; @mention of a non-existent user accepted.</li>
</ul>

<h3>1.4 Automations</h3>
<ul>
<li><b>Structural:</b> one action per rule; no conditions / "only if"; two separate engines (automations + date cascade) with two UIs.</li>
<li><b>Triggers too few:</b> only status / item-created / date / email. Missing: any-column-changed, person-assigned, number crosses threshold, item moved, comment/@mention, scheduled/recurring, button/manual. Status trigger matches one value only. Subitems never trigger.</li>
<li><b>Actions too narrow:</b> only status/date/person writable; no generic "set any column"/"clear". <b>Notify is broken</b> — no recipient, just a transient toast. Missing: create sub-item, cross-board create, duplicate, archive, add comment, webhook / Slack / Teams, start/stop timer.</li>
<li><b>assign_person</b> is name-based (fragile) and assigns a fixed member only. <b>send_email</b> has no CC/BCC, attachments, templates, or scheduling.</li>
<li><b>No run history;</b> failures are silent. Bulk edits skip automations entirely.</li>
</ul>

<h3>1.5 Dashboards</h3>
<ul>
<li>No drill-through on charts — only list widgets open items on click.</li>
<li>No single-widget cross-board rollup. Person filter is free-text, not a picker.</li>
<li>No auto-refresh (static until reload). No scheduled delivery / export-to-email.</li>
<li>No historical data — Burndown / velocity / cumulative-flow can't be accurate (Burndown is faked).</li>
<li>Minor: group-summary filter bug; multi-KPI ignores per-metric board; status-grid colour index; gauge text overlay.</li>
</ul>

<h3>1.6 Activity Log</h3>
<ul>
<li><b>Automation- and form-driven changes aren't logged</b> — only manual edits are recorded, so the history (and any burndown) is missing automated transitions.</li>
<li>No filter by member / date / action; capped at 200 entries; no export; per-board only.</li>
</ul>

<h3>1.7 Forms</h3>
<ul>
<li>No scheduled open/close; no response limit; the "closed" message isn't customizable.</li>
<li>The Active toggle needs a separate Save (looks instant, isn't).</li>
<li>No conditional logic, file upload, CAPTCHA, or confirmation email.</li>
</ul>

<h3>1.8 Cross-cutting (all column cells)</h3>
<ul>
<li>No server-side type validation. No undo.</li>
<li>Inconsistent "clear" and "save" behaviour, and inconsistent edit triggers, across types.</li>
</ul>

<div class="sec"></div>
<h2>2. Issues by Column Type</h2>
<p class="lead">Each built-in column type and its specific problems.</p>
<table>
<tr><th width="24%">Column type</th><th>Key issues</th></tr>
{col_table}
</table>

<div class="sec"></div>
<h2>3. New Features to Integrate</h2>

<h3>3.1 Views &amp; data</h3>
<ul>
<li><b>Multiple board views</b> — Kanban, Calendar, Timeline/Gantt, Workload, Chart, Cards, Map.</li>
<li><b>Connect Boards + Mirror + Rollup</b> — link items across boards, mirror their fields, roll up into one value.</li>
<li><b>Task dependencies + critical path + auto-shift</b> — when a task slips, dependent deadlines move automatically.</li>
<li><b>Server-side filter / sort / pagination</b> + typed values so boards scale to thousands of rows.</li>
</ul>

<h3>3.2 Column &amp; group menu options</h3>
<ul>
<li><b>Column:</b> add description, restrict view, restrict edit, hide summary, filter, sort, group-by, duplicate, add column left/right, change type, column summary (sum/avg/count), conditional formatting, freeze/pin, number &amp; date formatting.</li>
<li><b>Group:</b> collapse / expand / collapse-all, duplicate group, group summary footer, move all items, add group above/below, archive, set default group, sort items, export.</li>
</ul>

<h3>3.3 Automations &amp; logic</h3>
<ul>
<li>Unified builder — multiple actions + conditions ("when -> if -> then"); merge in date cascade.</li>
<li>Scheduled / recurring triggers; fix Notify (target a person); generic "set any column"; cross-board actions; run history.</li>
</ul>

<h3>3.4 Collaboration &amp; enterprise</h3>
<ul>
<li><b>Real-time collaboration</b> + presence (live edits, "who's here").</li>
<li><b>Updates feed</b> — rich text, attachments, reactions, read receipts.</li>
<li><b>Admin Audit Center</b> — cross-board activity, per-user drill-down, export.</li>
</ul>

<h3>3.5 Productivity</h3>
<ul>
<li><b>Templates gallery</b> — built-in templates for professional use-cases (CRM, sprints, content calendar, hiring, OKRs, client projects, help desk) + "save board as template".</li>
<li><b>Time-tracking suite</b> — timer, timesheets, billable rates, capacity.</li>
<li>Dashboards — drill-through, cross-board rollups, auto-refresh, scheduled delivery, historical data.</li>
<li>Notification preferences + daily digest; recurring tasks, reminders, SLA.</li>
</ul>

<div class="sec"></div>
<h2>4. AI Integrations</h2>

<h3>4.1 AI builders (natural language)</h3>
<ul>
<li><b>NL -> Board</b> — describe a board in a sentence ("a content calendar with status, owner, due date and a publish checklist") and generate a working board. <i>Effort: Low–Medium.</i></li>
<li><b>NL -> Automation</b> — describe a rule in plain English; it builds the recipe against the board's real columns. <i>Effort: Medium.</i></li>
<li><b>NL -> Formula</b> — "days between start and end, excluding weekends" produces a valid formula, validated before saving. <i>Effort: Low.</i></li>
</ul>

<h3>4.2 AI inside the board</h3>
<ul>
<li><b>Autofill column with AI / AI column</b> — summarize, classify, extract, score, or translate each row.</li>
<li><b>Smart email intake</b> — AI fills structured fields when an inbound email creates an item.</li>
<li><b>Ask-your-workspace</b> — semantic Q&amp;A ("what's blocked and who owns it?") with links to the items.</li>
<li><b>AI status digests</b> — auto-written daily / weekly standup summaries per board or person.</li>
</ul>


</body></html>
"""

with open(OUT, "wb") as f:
    res = pisa.CreatePDF(HTML, dest=f, encoding="utf-8")
print("ERROR" if res.err else f"OK -> {OUT}")
