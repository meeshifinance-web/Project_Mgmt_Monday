const pptx = require("pptxgenjs");
const p = new pptx();
p.layout = "LAYOUT_WIDE";          // 13.33 x 7.5"
p.author = "Divyanshi Mishra";
p.title = "Simplix Workboard — Product Review & Roadmap";

// ---- Light, professional palette (no purple) ----
const INK   = "16293D";   // dark navy — bold headings/body
const SUB    = "5B6B7C";  // muted
const ACCENT = "0E7C86";  // teal
const ACLT   = "E7F3F4";  // light teal card
const GRAY   = "F4F6F8";  // light gray card
const LINE   = "E2E7ED";
const RED    = "C0392B";
const AMBER  = "B7791F";
const GREEN  = "1E8449";
const HEAD = "Arial";     // bold headings
const BODY = "Calibri";
const W = 13.33, H = 7.5, M = 0.7;

const shadow = () => ({ type: "outer", color: "16293D", blur: 7, offset: 2, angle: 135, opacity: 0.10 });

function footer(s, n) {
  s.addShape(p.shapes.LINE, { x: M, y: 7.02, w: W - 2*M, h: 0, line: { color: LINE, width: 1 } });
  s.addText("Simplix Workboard  |  Product Review & Roadmap", { x: M, y: 7.05, w: 8, h: 0.3, fontSize: 9, color: SUB, fontFace: BODY });
  s.addText(`${n} / 14`, { x: W - M - 1.5, y: 7.05, w: 1.5, h: 0.3, fontSize: 9, color: SUB, align: "right", fontFace: BODY });
}
function header(s, kicker, title) {
  s.background = { color: "FFFFFF" };
  s.addText(kicker.toUpperCase(), { x: M, y: 0.42, w: W-2*M, h: 0.3, fontSize: 12, bold: true, color: ACCENT, charSpacing: 3, fontFace: HEAD, margin: 0 });
  s.addText(title, { x: M, y: 0.72, w: W-2*M, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD, margin: 0 });
}
function card(s, x, y, w, h, fill) {
  s.addShape(p.shapes.RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: LINE, width: 1 }, shadow: shadow() });
}
function chip(s, x, y, text, color, w=1.25) {
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.34, rectRadius: 0.17, fill: { color } });
  s.addText(text, { x, y, w, h: 0.34, fontSize: 10.5, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: HEAD, margin: 0 });
}
// bullet list helper
function bullets(s, x, y, w, h, items, size=15) {
  s.addText(items.map((it, i) => ({
    text: it.t,
    options: { bullet: { code: "2022", indent: 14 }, color: it.c || INK, bold: !!it.b, fontSize: size, breakLine: true, paraSpaceAfter: 8 }
  })), { x, y, w, h, fontFace: BODY, valign: "top" });
}

/* ---------------- 1. TITLE ---------------- */
let s = p.addSlide();
s.background = { color: INK };
s.addShape(p.shapes.RECTANGLE, { x: 0, y: 0, w: 0.28, h: H, fill: { color: ACCENT } });
s.addText("SIMPLIX WORKBOARD", { x: 1.1, y: 2.0, w: 11, h: 0.4, fontSize: 15, bold: true, color: ACCENT, charSpacing: 4, fontFace: HEAD });
s.addText("Product Review & Roadmap", { x: 1.05, y: 2.5, w: 11.5, h: 1.2, fontSize: 46, bold: true, color: "FFFFFF", fontFace: HEAD });
s.addText("Where we stand, what to fix, and how we beat Monday.com", { x: 1.1, y: 3.75, w: 11, h: 0.5, fontSize: 19, color: "CFE6E8", fontFace: BODY });
s.addText("Team meeting   |   2026-06-02   |   Divyanshi Mishra   |   Confidential",
  { x: 1.1, y: 5.6, w: 11, h: 0.4, fontSize: 13, color: "9FB3BE", fontFace: BODY });

/* ---------------- 2. EXEC SNAPSHOT ---------------- */
s = p.addSlide(); header(s, "Executive snapshot", "A strong product, held back by a few fixable gaps");
card(s, M, 1.55, 5.9, 4.0, ACLT);
s.addText("WHAT'S SOLID", { x: M+0.3, y: 1.75, w: 5.3, h: 0.35, fontSize: 14, bold: true, color: ACCENT, fontFace: HEAD });
bullets(s, M+0.25, 2.2, 5.4, 3.2, [
  { t: "Secure login — MFA + Microsoft SSO", b: true },
  { t: "21 column types & a rich 40+ widget dashboard" },
  { t: "Automations that fire correctly; forms; trash & recovery" },
  { t: "Verified by live, hands-on testing" },
], 14);
card(s, 6.85, 1.55, 5.78, 4.0, GRAY);
s.addText("WHAT HOLDS US BACK", { x: 7.15, y: 1.75, w: 5.3, h: 0.35, fontSize: 14, bold: true, color: RED, fontFace: HEAD });
bullets(s, 7.1, 2.2, 5.3, 3.2, [
  { t: "A few real bugs (security & data)", b: true },
  { t: "No multiple board views (table only)" },
  { t: "No cross-board links; shallow automations" },
  { t: "No AI yet — our biggest opportunity" },
], 14);
s.addText([
  { text: "Verdict:  ", options: { bold: true, color: INK } },
  { text: "~70% of the way to a commercial product. The remaining 30% is a focused build, not a thousand small fixes.", options: { color: INK } },
], { x: M, y: 5.75, w: W-2*M, h: 0.7, fontSize: 15, fontFace: BODY, fill: { color: ACLT }, align: "left", valign: "middle", margin: 10 });
footer(s, 2);

/* ---------------- 3. PRIORITIES ---------------- */
s = p.addSlide(); header(s, "Our priorities", "What we focus on first");
const pri = [
  ["FIX NOW", RED, "3 critical bugs — security & data loss"],
  ["QUICK WIN", AMBER, "Column polish + customization menu"],
  ["QUICK WIN", AMBER, "Templates gallery for pro use-cases"],
  ["QUICK WIN", AMBER, "Dashboard reporting & Audit center"],
  ["BIG ROCK", ACCENT, "Automation engine rebuild"],
  ["BIG ROCK", ACCENT, "Multiple views + connect boards"],
  ["LEAPFROG", GREEN, "AI builders — board / automation / formula"],
  ["LEAPFROG", GREEN, "Autofill columns with AI"],
];
let cx = M, cy = 1.6, cw = 5.9, ch = 1.15, gap = 0.22;
pri.forEach((it, i) => {
  const col = i % 2, row = Math.floor(i/2);
  const x = M + col * (cw + 0.35), y = 1.6 + row * (ch + gap);
  card(s, x, y, cw, ch, "FFFFFF");
  chip(s, x+0.25, y+0.4, it[0], it[1], 1.35);
  s.addText(it[2], { x: x+1.8, y: y, w: cw-2.0, h: ch, fontSize: 15, bold: true, color: INK, valign: "middle", fontFace: BODY, margin: 0 });
});
footer(s, 3);

/* ---------------- 4. CRITICAL BUGS ---------------- */
s = p.addSlide(); header(s, "Fix first", "3 critical bugs to fix before anything else");
const bugs = [
  ["SECURITY", "Automations have no access control", "Any manager can read, create, or delete automations on any board — even private ones they aren't part of."],
  ["DEAD FEATURE", "“Make Public” does nothing", "Switching a board to Public changes nothing; other people still cannot see it."],
  ["DATA LOSS", "An automation can lose an item", "The “move to group” action can move a task into another board, making it disappear from where it belongs."],
];
bugs.forEach((b, i) => {
  const y = 1.65 + i*1.5;
  card(s, M, y, W-2*M, 1.3, "FFFFFF");
  chip(s, M+0.3, y+0.48, b[0], RED, 1.7);
  s.addText(b[1], { x: M+2.2, y: y+0.18, w: 9.5, h: 0.45, fontSize: 18, bold: true, color: INK, fontFace: HEAD, margin: 0 });
  s.addText(b[2], { x: M+2.2, y: y+0.62, w: 9.7, h: 0.6, fontSize: 13.5, color: SUB, fontFace: BODY, margin: 0 });
});
s.addText("Also: no input validation, the global search API errors out, and “My Work” status colours show grey — all small, contained fixes.",
  { x: M, y: 6.35, w: W-2*M, h: 0.5, fontSize: 13, italic: true, color: SUB, fontFace: BODY });
footer(s, 4);

/* ---------------- 5. COLUMN SYSTEM ---------------- */
s = p.addSlide(); header(s, "Quick win", "Column system — finish the small things");
card(s, M, 1.55, 5.9, 4.4, GRAY);
s.addText("FIX THE ROUGH EDGES", { x: M+0.3, y: 1.75, w: 5.3, h: 0.35, fontSize: 14, bold: true, color: ACCENT, fontFace: HEAD });
bullets(s, M+0.25, 2.25, 5.4, 3.5, [
  { t: "Make every cell clearable — Link, Colour, Timeline, Checkbox can't reset today", b: true },
  { t: "Validate inputs — Number, Date, Email, Phone (+ click-to-call / mailto)" },
  { t: "Debounce saves — Link / Progress / Colour save on every keystroke" },
], 14);
card(s, 6.85, 1.55, 5.78, 4.4, ACLT);
s.addText("ADD THE COLUMN MENU", { x: 7.15, y: 1.75, w: 5.3, h: 0.35, fontSize: 14, bold: true, color: ACCENT, fontFace: HEAD });
bullets(s, 7.1, 2.25, 5.3, 3.5, [
  { t: "Customize status, add description, restrict view, hide summary", b: true },
  { t: "Filter, Sort, Group-by from the column header" },
  { t: "Duplicate column, add to the right, change type" },
  { t: "Autofill column with AI", b: true, c: GREEN },
], 14);
footer(s, 5);

/* ---------------- 6. AUTOMATIONS ---------------- */
s = p.addSlide(); header(s, "Big rock", "Automations — rebuild the engine");
card(s, M, 1.55, 5.9, 4.4, "FFFFFF");
s.addText("STRUCTURAL FIXES", { x: M+0.3, y: 1.75, w: 5.3, h: 0.35, fontSize: 14, bold: true, color: ACCENT, fontFace: HEAD });
bullets(s, M+0.25, 2.25, 5.4, 3.5, [
  { t: "Multiple actions per rule (set Done AND assign AND notify)", b: true },
  { t: "Conditions / “only if” (when Done IF priority = High)", b: true },
  { t: "Merge the two split engines into one builder" },
  { t: "Run history + surface failures (silent today)" },
], 14);
card(s, 6.85, 1.55, 5.78, 4.4, "FFFFFF");
s.addText("MORE TRIGGERS & ACTIONS", { x: 7.15, y: 1.75, w: 5.3, h: 0.35, fontSize: 14, bold: true, color: ACCENT, fontFace: HEAD });
bullets(s, 7.1, 2.25, 5.3, 3.5, [
  { t: "Scheduled / recurring (“every Monday 9am”, “3 days before due”)", b: true },
  { t: "Fix Notify — let it reach a chosen person" },
  { t: "Set any column, create sub-item, cross-board create" },
  { t: "Webhook / Slack / Teams; subitem triggers" },
], 14);
footer(s, 6);

/* ---------------- 7. DASHBOARDS ---------------- */
s = p.addSlide(); header(s, "Quick win", "Dashboards — make reporting real");
bullets(s, M, 1.7, W-2*M, 3.6, [
  { t: "Click-through charts — click a bar / slice to see the items behind it", b: true },
  { t: "Cross-board rollups — one KPI that sums across boards; a real people-picker for the person filter", b: true },
  { t: "Auto-refresh — dashboards are a frozen snapshot until you reload" },
  { t: "Scheduled delivery — email / Slack a dashboard snapshot every Monday" },
  { t: "Historical data — record changes over time so Burndown & velocity become real" },
], 16);
s.addText("Our 40+ widget library already beats Monday's defaults — these four upgrades make it the best dashboard in the category.",
  { x: M, y: 5.6, w: W-2*M, h: 0.7, fontSize: 14.5, bold: true, color: INK, fill: { color: ACLT }, valign: "middle", margin: 12, fontFace: BODY });
footer(s, 7);

/* ---------------- 8. FORMS + AUDIT ---------------- */
s = p.addSlide(); header(s, "Quick wins", "Forms polish & Activity / Audit center");
card(s, M, 1.55, 5.9, 4.4, GRAY);
s.addText("FORMS", { x: M+0.3, y: 1.75, w: 5, h: 0.35, fontSize: 14, bold: true, color: ACCENT, fontFace: HEAD });
bullets(s, M+0.25, 2.25, 5.4, 3.5, [
  { t: "Scheduled open / close & response limits", b: true },
  { t: "Conditional logic, file upload, CAPTCHA" },
  { t: "Confirmation email + custom “closed” message" },
  { t: "Make the Active toggle save instantly" },
], 14);
card(s, 6.85, 1.55, 5.78, 4.4, ACLT);
s.addText("ACTIVITY LOG & AUDIT CENTER", { x: 7.15, y: 1.75, w: 5.3, h: 0.35, fontSize: 14, bold: true, color: ACCENT, fontFace: HEAD });
bullets(s, 7.1, 2.25, 5.3, 3.5, [
  { t: "Log automation- & form-driven changes (the big gap)", b: true },
  { t: "Filter by person / date / action; full history + export" },
  { t: "Admin “audit center” — cross-board activity, per-user drill-down", b: true },
], 14);
footer(s, 8);

/* ---------------- 9. TEMPLATES ---------------- */
s = p.addSlide(); header(s, "Quick win", "Templates — kill the blank page");
bullets(s, M, 1.7, 7.4, 3.8, [
  { t: "Built-in template gallery for professional use-cases", b: true },
  { t: "CRM, sprints, content calendar, hiring, OKRs, client projects" },
  { t: "Biggest lever for activation (new users) and virality (shareable templates)", b: true },
  { t: "Low effort — we already have board-cloning plumbing to build on" },
], 16);
card(s, 8.5, 1.7, 4.13, 3.8, INK);
s.addText("200+", { x: 8.5, y: 2.1, w: 4.13, h: 1.2, fontSize: 64, bold: true, color: ACCENT, align: "center", fontFace: HEAD });
s.addText("templates ship with Monday — its #1 onboarding path.", { x: 8.8, y: 3.4, w: 3.6, h: 1.0, fontSize: 14, color: "CFE6E8", align: "center", fontFace: BODY });
s.addText("Even 10 strong ones close most of the gap.", { x: 8.8, y: 4.3, w: 3.6, h: 0.8, fontSize: 13, italic: true, color: "9FB3BE", align: "center", fontFace: BODY });
footer(s, 9);

/* ---------------- 10. AI BUILDERS ---------------- */
s = p.addSlide(); header(s, "The leapfrog", "AI builders — where we beat Monday");
const ai = [
  ["NL → Board", "“A content calendar with status, owner, due date and a publish checklist” → a working board. Kills the blank page; demo-able.", "Effort: Low–Med"],
  ["NL → Automation", "Describe a rule in English → it builds the recipe against your real columns.", "Effort: Med"],
  ["NL → Formula", "“Days between start and end, excluding weekends” → a valid formula.", "Effort: Low"],
];
ai.forEach((a, i) => {
  const x = M + i*4.06;
  card(s, x, 1.6, 3.8, 3.5, "FFFFFF");
  s.addShape(p.shapes.RECTANGLE, { x, y: 1.6, w: 3.8, h: 0.12, fill: { color: GREEN } });
  s.addText(a[0], { x: x+0.25, y: 1.85, w: 3.4, h: 0.5, fontSize: 19, bold: true, color: INK, fontFace: HEAD, margin: 0 });
  s.addText(a[1], { x: x+0.25, y: 2.45, w: 3.4, h: 1.9, fontSize: 13.5, color: SUB, fontFace: BODY, margin: 0, valign: "top" });
  s.addText(a[2], { x: x+0.25, y: 4.55, w: 3.4, h: 0.4, fontSize: 12, bold: true, color: GREEN, fontFace: HEAD, margin: 0 });
});
s.addText("Monday's AI is bolt-on. An AI-native Simplix — generate, automate, and query in plain English — is a genuine category move.",
  { x: M, y: 5.5, w: W-2*M, h: 0.7, fontSize: 14.5, bold: true, color: INK, fill: { color: ACLT }, valign: "middle", margin: 12, fontFace: BODY });
footer(s, 10);

/* ---------------- 11. PARITY GAPS (table) ---------------- */
s = p.addSlide(); header(s, "Parity gaps", "What Monday still does better");
const th = (t) => ({ text: t, options: { fill: { color: INK }, color: "FFFFFF", bold: true, fontSize: 13, align: "left", valign: "middle", fontFace: HEAD } });
const td = (t, b=false, c=INK) => ({ text: t, options: { color: c, bold: b, fontSize: 13, valign: "middle", fontFace: BODY } });
const rows = [
  [th("Capability"), th("Simplix"), th("Why it matters")],
  [td("Multiple views (Kanban / Calendar / Gantt)", true), td("Table only", false, RED), td("See the same data many ways")],
  [td("Connect boards + Mirror + Rollup", true), td("None", false, RED), td("One connected system, not islands")],
  [td("Real-time collaboration", true), td("None", false, RED), td("Live edits & presence")],
  [td("Integrations (Slack/Teams/Gmail/Zapier)", true), td("None", false, RED), td("Fits existing workflows")],
  [td("Task dependencies + critical path", true), td("None", false, RED), td("Real project management")],
  [td("Native mobile apps", true), td("Web/PWA only", false, AMBER), td("Field & on-the-go use")],
];
s.addTable(rows, { x: M, y: 1.65, w: W-2*M, colW: [5.2, 2.4, 4.33], rowH: 0.62,
  border: { type: "solid", pt: 1, color: LINE }, align: "left", valign: "middle", margin: [3, 8, 3, 8] });
footer(s, 11);

/* ---------------- 12. ROADMAP ---------------- */
s = p.addSlide(); header(s, "The plan", "Roadmap in 3 phases");
const phases = [
  ["1.  Real product", AMBER, "Fix critical bugs, column polish + menu, templates, dashboard reporting, audit center", "Stops churn; feels complete"],
  ["2.  Parity", ACCENT, "Multiple views, connect/mirror/rollup, automation rebuild, real-time, integrations", "Teams & enterprises can adopt"],
  ["3.  Surpass", GREEN, "AI builders, AI columns, ask-your-workspace, cross-board BI, templates marketplace", "An AI-native work OS Monday can't match"],
];
phases.forEach((ph, i) => {
  const y = 1.6 + i*1.55;
  card(s, M, y, W-2*M, 1.35, "FFFFFF");
  s.addShape(p.shapes.RECTANGLE, { x: M, y, w: 0.14, h: 1.35, fill: { color: ph[1] } });
  s.addText(ph[0], { x: M+0.4, y: y+0.22, w: 3.0, h: 0.9, fontSize: 20, bold: true, color: ph[1], fontFace: HEAD, valign: "middle", margin: 0 });
  s.addText(ph[2], { x: M+3.6, y: y+0.2, w: 5.9, h: 1.0, fontSize: 13.5, color: INK, fontFace: BODY, valign: "middle", margin: 0 });
  s.addText(ph[3], { x: M+9.7, y: y+0.2, w: 2.0, h: 1.0, fontSize: 12.5, bold: true, italic: true, color: SUB, fontFace: BODY, valign: "middle", margin: 0 });
});
footer(s, 12);

/* ---------------- 13. DECISION ---------------- */
s = p.addSlide(); header(s, "Decision", "What we need from this meeting");
bullets(s, M, 1.7, W-2*M, 3.6, [
  { t: "Agree the Phase-1 list — bug fixes, column polish + menu, templates, dashboard reporting, audit center", b: true },
  { t: "Green-light the AI builders as our differentiator — start with NL → Formula, then NL → Board", b: true },
  { t: "Decide ownership & timeline for the automation-engine rebuild" },
  { t: "Confirm budget for an AI API key + per-workspace usage limits" },
], 16);
s.addText([
  { text: "Recommended first sprint:  ", options: { bold: true, color: INK } },
  { text: "the 3 critical bug fixes + 10 starter templates + the column “clear & validate” pass — visible wins within two weeks.", options: { color: INK } },
], { x: M, y: 5.6, w: W-2*M, h: 0.8, fontSize: 15, fontFace: BODY, fill: { color: ACLT }, valign: "middle", margin: 12 });
footer(s, 13);

/* ---------------- 14. CLOSING ---------------- */
s = p.addSlide();
s.background = { color: INK };
s.addShape(p.shapes.RECTANGLE, { x: 0, y: 0, w: 0.28, h: H, fill: { color: ACCENT } });
s.addText("Let's build the best work OS in the market.", { x: 1.1, y: 2.6, w: 11.2, h: 1.6, fontSize: 40, bold: true, color: "FFFFFF", fontFace: HEAD });
s.addText("Reach parity. Win on AI.", { x: 1.15, y: 4.2, w: 11, h: 0.6, fontSize: 22, bold: true, color: ACCENT, fontFace: HEAD });
s.addText("Thank you   |   Questions & discussion", { x: 1.15, y: 5.4, w: 11, h: 0.4, fontSize: 14, color: "9FB3BE", fontFace: BODY });

p.writeFile({ fileName: "Simplix_Meeting_Deck.pptx" }).then(f => console.log("OK ->", f));
