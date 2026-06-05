# -*- coding: utf-8 -*-
"""Professional black & white WORK REPORT: bugs fixed, features delivered."""
from xhtml2pdf import pisa

OUT = "Simplix_Work_Report.pdf"

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
.meta { font-size: 9pt; color: #444; margin: 0 0 2pt; }
hr { border: none; border-top: 0.5pt solid #999; margin: 8pt 0; }
table { width: 100%; border-collapse: collapse; margin: 5pt 0; font-size: 9pt; }
th { background: #1a1a1a; color: #fff; padding: 4pt 7pt; text-align: left; }
td { padding: 4pt 7pt; border: 0.5pt solid #bbb; vertical-align: top; }
tr:nth-child(even) td { background: #f2f2f2; }
.cover { text-align: left; border-bottom: 3pt solid #000; padding-bottom: 10pt; margin-bottom: 8pt; }
.sec { page-break-before: always; }
.tagdone { font-weight: bold; }
"""

# ---------- COLUMN TYPE FIXES TABLE ----------
col_rows = [
 ("Status / Priority", "Live search box added to the options list. Editing labels now supports reorder (move up / down), case-insensitive duplicate-name check that blocks save, and recolour by swatch. Priority renders with icons. Dead \"Auto-assign labels\" footer removed."),
 ("Dropdown", "Options editor gains reorder and duplicate detection; an option can be created directly from the search box. Chips no longer hard-truncate at ~100px. Stored value normalised."),
 ("Rating", "Configurable maximum (settings.max, 1–10) instead of fixed 5. Half-star support — click the left half of a star for ½, the right half for full. Hover tooltip and live preview of the value under the cursor. Out-of-range API values rejected by server validation."),
 ("Progress", "Clamped to 0–100 on input and on blur — 5000%/negative values can no longer break the row layout. Weighted-progress helper added. Explicit clear supported."),
 ("Checkbox", "True tri-state — a cell can return to empty/unset, not just permanently true/false, so it can be cleared again."),
 ("Tags", "Shared per-board tag vocabulary with autocomplete and de-duplication; a comma inside a tag no longer splits it. Tags render in distinct colours. Clearing is explicit."),
 ("Timeline (date range)", "Stored as structured start/end and can be cleared (clearing both ends stores empty, not \" -&gt; \"). Validation that end &gt;= start; one-sided ranges rejected; a clear button is provided. Now sortable / filterable by date and usable by the Timeline/Gantt view."),
 ("Link", "Edit/clear reachable via an editor (single click no longer only opens the URL); explicit clear button. URLs sanitised — javascript:/data:/vbscript:/file: schemes blocked (stored-XSS fix) and bare hosts get https:// so they stop resolving as in-app relative links. Optional display label; saves on blur."),
 ("Number", "Server rejects text / NaN / Infinity. Number formatting added — currency, %, decimals and thousands separators via column settings. Column summary (sum / avg / count) shown in the group/board footer."),
 ("Email", "Format validated server-side. Cell is a mailto: click action."),
 ("Phone", "Validated and digit-limited input. Cell is a tel: click-to-call action."),
 ("Time tracking", "Real start/stop timer with accumulation across sessions, persisted totals, per-person timesheets and billable rates (replaces the plain text box)."),
 ("Creation log", "Companion \"last updated by / at\" alongside \"created by / at\". Timestamps pinned to IST so they match the rest of the app."),
 ("People / Person", "Assignment stored by user ID, not name string — duplicate names no longer collide and renaming a user keeps their assignments (migration script included). Members can self-assign. Avatar photos shown (not just initials), overflow shows \"+N more\", and search appears as needed."),
 ("Files", "Drag-and-drop onto the cell; image thumbnails generated client-side. Access control added — a file can only be fetched by a user who can access a board that references it (closes the guess-the-filename hole). Failed deletes surface an error."),
 ("Formula", "Hardened evaluation — POWER overflow now reports #NUM! correctly. Formula visible and editable in a dedicated editor. (Foundation laid for stored/derivable values via the AI column + server validation.)"),
]
col_table = "".join(
    f"<tr><td style='width:24%'><b>{t}</b></td><td>{d}</td></tr>" for t, d in col_rows
)

HTML = f"""
<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>
<div class="cover">
<h1>Simplix Workboard — Work Report</h1>
</div>

<h2>1. Bugs Fixed &amp; Hardening</h2>

<h3>1.1 Critical</h3>
<ul>
<li><b>Automations access control (IDOR) closed</b> — automation read/create/update/delete is now gated by board access (org-wide vs private membership), so a manager can no longer touch automations on a board they aren't a member of.</li>
<li><b>"Make Public" now works</b> — board <i>visibility</i> (private / org_wide) is honoured everywhere: board listing, global search and item access all respect it; invalid visibility values are rejected (400).</li>
<li><b>"Move to group" can no longer lose an item</b> — a same-board guard prevents an item being moved into another board where it would disappear.</li>
<li><b>Item-email IDOR closed</b> — email threads on an item were readable by any logged-in user by guessing the id; access is now gated on board membership/visibility (403 otherwise).</li>
<li><b>Cross-board email injection blocked</b> — an inbound-email automation can no longer be pointed at another board's group to silently inject items there; the target group must belong to the automation's own board.</li>
</ul>

<h3>1.2 High / Data integrity</h3>
<ul>
<li><b>Server-side validation added across the board</b> — a single <i>columnValidate</i> authority funnels the upsert, bulk-upsert and import paths: Number rejects "banana"/NaN/Infinity, Date rejects impossible dates, Rating/Progress are clamped, Email is format-checked, and unknown column types are rejected at creation.</li>
<li><b>Kanban view wired into the board</b> — the built-but-disconnected Kanban renders and is switchable/persisted alongside the new view types.</li>
<li><b>"My Work" status colours fixed</b> — was reading <i>settings.labels/l.text</i> (which never matched, so every pill was grey); now reads <i>settings.options &#123;label, color&#125;</i>.</li>
<li><b>Length caps &amp; XSS hardening</b> — comments capped (5,000 chars); URL/link values sanitised against javascript:/data: schemes so stored-XSS payloads can't fire in-app, in exports or emails.</li>
<li><b>CSV/spreadsheet formula injection neutralised</b> — exported cells beginning with =, +, -, @ are escaped so a malicious cell can't execute when the export is opened in Excel/Sheets.</li>
<li><b>Column &amp; view types validated</b> — unknown column types are rejected at create/update (400); view <i>type</i> is whitelisted (table, kanban, dashboard, calendar, timeline, gantt, workload, chart, cards, map).</li>
</ul>

<h3>1.3 Medium / Low</h3>
<ul>
<li><b>Global search (/api/search) fixed</b> — the broken query (500) is rewritten: value parsing handles JSON/object/person shapes, joins use the correct board id via groups, sub-items are excluded, and results respect visibility. Now UI-wired.</li>
<li><b>Empty names rejected</b> — item (and board) creation/rename refuse blank names ("Item name cannot be empty").</li>
<li><b>@mention validation</b> — mentions are filtered to real, active users who can actually see the board; non-existent ids are dropped instead of accepted.</li>
</ul>

<h3>1.4 Automations — rebuilt</h3>
<ul>
<li><b>Single rule engine</b> (<i>automationEngine</i>) now shared by the status-change, item-created and date-arrives triggers, so a rule behaves identically no matter what fired it — ending the two-engine/two-UI split.</li>
<li><b>Conditions added</b> — "only if" CONDITIONS (column / operator / value, AND-combined) evaluated before actions run.</li>
<li><b>Multiple actions per rule</b> — a rule runs an ordered list of actions; legacy single-action rules still work (backward-compatible fallback). Migration script included.</li>
<li><b>Notify fixed</b> and actions broadened (set/clear any column, notify a real recipient). Side-effects (emails) are deferred and run after commit so rows are durable first.</li>
<li><b>Date-arrives (cascade) engine merged in</b> — it now delegates to the same shared engine, so date-triggered rules honour the same "only if" conditions and ordered multi-action list as status/item-created rules. A rule whose conditions aren't met stays eligible to fire on a later tick (correct dedup).</li>
<li><b>Automation email recipients validated</b> — addresses are format-checked and de-duplicated before SMTP, so a typo or a non-email value in a recipient column is skipped instead of throwing; resolution supports a specific address or a chosen email column.</li>
<li><b>Person assignment by ID</b> (migration <i>migrate-person-values-to-ids</i>) instead of fragile name matching; assignment emails diff by stable id so renamed users still get notified.</li>
<li><b>Automation-driven changes now logged</b> to activity history (previously only manual edits were recorded). Backed by an extensive test suite (engine, combos, HTTP, item-created).</li>
</ul>

<h3>1.5 Dashboards</h3>
<ul>
<li><b>Historical data</b> — a <i>dashboardEngine</i> captures one aggregate snapshot per board per day, so burndown / trend widgets are real, not faked.</li>
<li><b>Drill-through on every chart</b> — clicking a chart segment (not just list widgets) opens a modal of the underlying items, with the owner/person shown.</li>
<li><b>Scheduled delivery</b> — daily/weekly email digest of a dashboard's boards (IST-scheduled), with an in-app config modal and a "send now" action. New <i>/snapshots</i> and <i>/schedule</i> endpoints.</li>
<li>Board-level dashboard view added with KPI, status distribution, workload, deadlines and group-summary widgets.</li>
</ul>

<h3>1.6 Activity Log &amp; Audit</h3>
<ul>
<li><b>200-entry cap removed</b> — board activity is now filtered + paginated (by user, action, date range, free-text search).</li>
<li><b>Admin Audit Center</b> — new cross-board activity panel with per-user drill-down, action/user/date filters, pagination and CSV export.</li>
</ul>

<h3>1.7 Forms</h3>
<ul>
<li><b>Scheduled open/close</b> (opens_at), <b>response limit</b>, and a <b>customisable "closed" message</b>.</li>
<li><b>File upload</b> on forms (20&nbsp;MB cap, sanitised filenames).</li>
<li><b>CAPTCHA</b> (signed challenge) and <b>confirmation email</b> on submission (configurable subject/body, mapped to an email column).</li>
<li>Active state is saved correctly (no longer a separate, deceptive Save).</li>
</ul>

<h3>1.8 Notifications &amp; live updates</h3>
<ul>
<li><b>Read/unread state surfaced</b> — unread notifications are visually distinct (highlight + bold) and become clickable to navigate to the source item; mark-as-read on interaction.</li>
<li><b>Live badge polling</b> — the unread count refreshes every 15s and immediately when the tab regains focus, so the bell stays current without a reload.</li>
<li><b>Comment / @mention emails</b> — a mention or reply now also sends an email (not just an in-app bell), with a NOTIFY_ON_MENTION kill-switch.</li>
<li><b>Admin user list is live</b> — the Profile/Admin tab polls every 8s (silent, no flicker) so member changes appear without a manual refresh.</li>
<li><b>Generic mailer added</b> — a shared <i>sendMail</i> powers the digest engine and falls back to a console log when SMTP isn't configured, so scheduling logic still runs in dev.</li>
</ul>

<h3>1.9 Cross-cutting</h3>
<ul>
<li>Consistent clear/save behaviour and consistent edit triggers across all cell types, centralised in <i>cellFormat</i> helpers (pure, unit-testable).</li>
<li>Performance indexes added (column_values, items by group, time entries) so boards scale.</li>
</ul>

<div class="sec"></div>
<h2>2. Fixes by Column Type</h2>
<p class="lead">Each built-in column type and what was corrected.</p>
<table>
<tr><th width="24%">Column type</th><th>What was fixed / added</th></tr>
{col_table}
</table>

<div class="sec"></div>
<h2>3. New Features Delivered</h2>

<h3>3.1 Views &amp; data</h3>
<ul>
<li><b>Six new board views</b> wired in alongside Table/Kanban — <b>Calendar, Timeline/Gantt, Workload, Chart, Cards and Map</b>. View type is persisted per board.</li>
<li><b>Connect Boards + Mirror + Rollup</b> — new column types that link items across boards, mirror a linked column (read-only), and roll up a numeric column (sum / avg / min / max / median / count…). Mirror/rollup values computed server-side (<i>connectionResolver</i>) and injected into the board payload.</li>
<li><b>Task dependencies + critical path + auto-shift</b> — a <i>dependency</i> column stores predecessors; a Finish-to-Start forward pass (<i>dependencyEngine</i>, cycle-safe, push-only) auto-shifts dependent timelines when a task slips, and computes the critical path.</li>
<li><b>Server-side filter / sort / pagination</b> (<i>itemQuery</i>) — typed SQL casting (number to numeric, date to date) with bound parameters, so boards scale to thousands of rows and "10" sorts after "9".</li>
</ul>

<h3>3.2 Column &amp; group menu options</h3>
<ul>
<li><b>Column:</b> duplicate a column (type + settings + all values), number &amp; date formatting, column summary (sum/avg/count) in the footer, and type-config panels for the new connect/mirror/rollup/dependency/AI types.</li>
<li><b>Group:</b> duplicate group (with items + values), move all items to another group, collapse / collapse-all, and per-group CSV export.</li>
</ul>

<h3>3.3 Collaboration &amp; enterprise</h3>
<ul>
<li><b>Admin Audit Center</b> — cross-board activity, per-user drill-down, CSV export (see 1.6).</li>
<li><b>Comment / @mention emails</b> and live notifications (see 1.8).</li>
</ul>

<h3>3.4 Productivity</h3>
<ul>
<li><b>Templates gallery</b> — curated, instantly-usable board templates (Project Management and more) with columns, groups and starter items.</li>
<li><b>Time-tracking suite</b> — start/stop timer with one-active-timer enforcement, manual entry, edit/delete of individual sessions, and persisted accumulated totals. Board-level <b>timesheets</b> (tracked vs billable hours, cost from each person's rate, capacity utilisation over a date range), per-person <b>billable rates</b> and <b>weekly capacity</b>. New <i>/api/time</i> route (start, stop, manual, running, cell, timesheet, billing), <i>time_entries</i> table + user billing columns.</li>
<li><b>Dashboards</b> — historical snapshots, scheduled email delivery, board dashboard view (see 1.5).</li>
</ul>

<div class="sec"></div>
<h2>4. AI Integrations Delivered</h2>

<h3>4.1 AI builders (natural language)</h3>
<ul>
<li><b>NL -&gt; Board</b> — describe a board in a sentence and generate a working board spec (columns + groups), validated before save.</li>
<li><b>NL -&gt; Automation</b> — plain-English rule compiled into a recipe against the board's real columns, validated.</li>
<li><b>NL -&gt; Formula</b> — plain English compiled to a valid formula and checked against the supported function set before saving.</li>
<li>Implemented deterministically (<i>nlEngine</i>) — validated, no hallucination; LLM-ready but stands alone.</li>
</ul>

<h3>4.2 AI inside the board</h3>
<ul>
<li><b>AI column</b> — a new column type that derives a per-row value (summary / classify / extract emails-phones-links-numbers / score / sentiment) from other columns. Pure and unit-testable (<i>aiColumn</i>).</li>
<li><b>Ask-your-workspace</b> — semantic Q&amp;A panel ("what's blocked and who owns it?") returning answers that link to the items.</li>
<li><b>AI status digests</b> — auto-written standup summaries per board / person.</li>
<li>New backend route <i>/api/ai</i> and <i>AiAssistantPanel</i> wired into the app shell.</li>
</ul>

<div class="sec"></div>
<h2>5. Testing &amp; Migrations</h2>
<h3>5.1 Test coverage added</h3>
<ul>
<li>Automation engine suites — conditions/actions, trigger combinations, HTTP path, and item-created trigger.</li>
<li>Rigorous QA scripts for cross-board <b>connections</b>, <b>dependencies</b>, <b>email</b>, <b>time tracking</b>, and <b>query scale</b>; plus a column-verification pass and people/person checks.</li>
<li>End-to-end QA harnesses (full, rigorous, targeted) exercising the API surface.</li>
</ul>
<h3>5.2 Data migrations (idempotent)</h3>
<ul>
<li>Automation conditions/actions columns; person-values -&gt; user IDs; form notify-on-submission flag.</li>
<li>New schema provisioned on boot — <i>time_entries</i> table, user billing/capacity columns, and supporting indexes.</li>
</ul>

</body></html>
"""

with open(OUT, "wb") as f:
    res = pisa.CreatePDF(HTML, dest=f, encoding="utf-8")
print("ERROR" if res.err else f"OK -> {OUT}")
