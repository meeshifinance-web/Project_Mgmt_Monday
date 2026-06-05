# -*- coding: utf-8 -*-
"""Black-box QA harness for Simplix Workboard. Exercises the live API across
roles, validation, authorization, and data-integrity edge cases. Records
findings without stopping on first failure."""
import requests, json, random, string

BASE = "http://localhost:3001/api"
findings = []   # (severity, area, title, detail)
def note(sev, area, title, detail=""):
    findings.append((sev, area, title, detail))
    print(f"[{sev}] {area}: {title}  {('- '+detail) if detail else ''}")

def rnd(n=6): return ''.join(random.choices(string.ascii_lowercase, k=n))

def sess_login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    return s if r.status_code == 200 else None

admin = sess_login("admin@simplixart.com", "Admin@1234")
assert admin, "admin login failed"

# ── 0. Provision test users (manager, member, user) ──────────────────────────
users = {}
for role in ["manager", "member", "user"]:
    email = f"qa_{role}_{rnd(4)}@test.com"
    pw = "Passw0rd!23"
    r = admin.post(f"{BASE}/auth/admin/create-user",
                   json={"email": email, "password": pw, "name": f"QA {role}", "role": role})
    if r.status_code == 201:
        users[role] = {"email": email, "pw": pw, "sess": sess_login(email, pw), "id": r.json().get("id")}
    else:
        note("INFO", "setup", f"could not create {role}", f"{r.status_code} {r.text[:80]}")

# ── 1. AUTH validation ───────────────────────────────────────────────────────
def auth_tests():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@simplixart.com", "password": "wrong"})
    if r.status_code != 401: note("BUG", "auth", "wrong password not 401", str(r.status_code))
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@simplixart.com"})
    if r.status_code not in (400,401): note("BUG", "auth", "missing password not 400", str(r.status_code))
    r = requests.get(f"{BASE}/boards")
    if r.status_code != 401: note("BUG", "auth", "unauthenticated board list not 401", str(r.status_code))
    # weak password on register
    r = requests.post(f"{BASE}/auth/register", json={"email": f"{rnd()}@t.com", "password": "1234567", "name":"x"})
    if r.status_code == 201: note("BUG", "auth", "accepted <8 char password on register")
    # SQL-ish email
    r = requests.post(f"{BASE}/auth/login", json={"email": "x' OR '1'='1", "password": "x"})
    if r.status_code == 200: note("CRIT", "auth", "SQL-injection-like login succeeded")
auth_tests()

# ── 2. Create a board to test with ───────────────────────────────────────────
r = admin.post(f"{BASE}/boards", json={"name": f"QA Board {rnd()}", "visibility": "private"})
board = r.json() if r.status_code == 201 else None
if not board: note("BUG","boards","admin could not create board", f"{r.status_code} {r.text[:100]}");
bid = board["id"] if board else None
gid = board["groups"][0]["id"] if board and board.get("groups") else None
cols = {c["title"]: c for c in board["columns"]} if board else {}

# ── 3. INPUT VALIDATION on column values ─────────────────────────────────────
def make_item(name="Test item"):
    r = admin.post(f"{BASE}/items", json={"group_id": gid, "name": name})
    return r.json() if r.status_code == 201 else None

def set_val(item_id, col_id, value):
    return admin.post(f"{BASE}/column-values/upsert", json={"item_id": item_id, "column_id": col_id, "value": value})

if bid:
    it = make_item()
    iid = it["id"] if it else None
    # add a number column
    rc = admin.post(f"{BASE}/columns", json={"board_id": bid, "title": "Num", "type": "number"})
    numcol = rc.json() if rc.status_code == 201 else None
    if numcol and iid:
        # non-numeric into number column
        r = set_val(iid, numcol["id"], "not-a-number")
        if r.status_code == 200: note("BUG", "validation", "number column accepts non-numeric text", "'not-a-number' stored")
        # huge number / negative / scientific
        for v in ["-999999", "1e308", "99999999999999999999999999", "NaN", "Infinity"]:
            r = set_val(iid, numcol["id"], v)
            if r.status_code == 200 and v in ("NaN","Infinity"):
                note("BUG", "validation", f"number column stores '{v}'")
    # date column: invalid date
    rc = admin.post(f"{BASE}/columns", json={"board_id": bid, "title": "D", "type": "date"})
    datecol = rc.json() if rc.status_code==201 else None
    if datecol and iid:
        r = set_val(iid, datecol["id"], "2026-13-45")
        if r.status_code == 200: note("BUG","validation","date column accepts invalid date '2026-13-45'")
        r = set_val(iid, datecol["id"], "banana")
        if r.status_code == 200: note("MED","validation","date column accepts arbitrary text 'banana'")
    # email column: invalid email
    rc = admin.post(f"{BASE}/columns", json={"board_id": bid, "title": "E", "type": "email"})
    ecol = rc.json() if rc.status_code==201 else None
    if ecol and iid:
        r = set_val(iid, ecol["id"], "definitely-not-an-email")
        if r.status_code == 200: note("MED","validation","email column accepts invalid email")
    # XSS payload stored verbatim?
    if iid and numcol:
        xss = "<script>alert(1)</script>"
        r = set_val(iid, cols.get("Status",{}).get("id", numcol["id"]), xss)
        # re-read
        rb = admin.get(f"{BASE}/boards/{bid}")
        body = rb.text
        if xss in body: note("MED","security","XSS payload stored & returned verbatim (relies on React escaping)")
    # rating out of range
    rc = admin.post(f"{BASE}/columns", json={"board_id": bid, "title": "R", "type": "rating"})
    rcol = rc.json() if rc.status_code==201 else None
    if rcol and iid:
        r = set_val(iid, rcol["id"], "999")
        if r.status_code==200: note("LOW","validation","rating column accepts value 999 (UI expects 1-5)")
    # progress out of range
    rc = admin.post(f"{BASE}/columns", json={"board_id": bid, "title": "P", "type": "progress"})
    pcol = rc.json() if rc.status_code==201 else None
    if pcol and iid:
        r = set_val(iid, pcol["id"], "5000")
        if r.status_code==200: note("LOW","validation","progress column accepts 5000% (UI expects 0-100)")
    # very long string
    if iid and cols.get("Status"):
        big = "A"*100000
        r = set_val(iid, cols["Status"]["id"], big)
        if r.status_code==200: note("LOW","validation","no length cap on column value (100k chars accepted)")

# ── 4. AUTHORIZATION: automations IDOR (suspected) ───────────────────────────
if bid and users.get("manager"):
    mgr = users["manager"]["sess"]
    # manager is NOT a member of admin's private board
    r = mgr.get(f"{BASE}/automations/board/{bid}")
    if r.status_code == 200:
        note("CRIT","authz","manager can READ automations of a private board they're not a member of", f"GET ok ({r.status_code})")
    r = mgr.post(f"{BASE}/automations", json={"board_id": bid, "name":"evil","trigger_type":"item_created","trigger_config":{},"action_type":"send_email","action_config":{"to":"x@x.com","subject":"s","body":"b"}})
    if r.status_code in (200,201):
        note("CRIT","authz","manager can CREATE automation on a board they can't access", f"POST ok ({r.status_code})")
        autoid = r.json().get("id")
        rd = mgr.delete(f"{BASE}/automations/{autoid}")
        if rd.status_code==200: note("CRIT","authz","manager can DELETE automations by id with no board check")

# ── 5. AUTHORIZATION: member/user write restrictions ─────────────────────────
if bid and users.get("user"):
    usr = users["user"]["sess"]
    # add the 'user' as a member so they can access, then verify read-only
    admin.post(f"{BASE}/boards/{bid}/members", json={"email": users["user"]["email"]})
    if iid:
        r = usr.post(f"{BASE}/column-values/upsert", json={"item_id": iid, "column_id": cols["Status"]["id"], "value":"Done"})
        if r.status_code == 200: note("BUG","authz","'user' (read-only role) was able to edit a column value")
        r = usr.post(f"{BASE}/items", json={"group_id": gid, "name":"sneaky"})
        if r.status_code == 201: note("BUG","authz","'user' (read-only role) was able to create an item")

# ── 6. AUTHORIZATION: non-member cannot access board ─────────────────────────
if bid and users.get("member"):
    mem = users["member"]["sess"]
    r = mem.get(f"{BASE}/boards/{bid}")
    if r.status_code == 200: note("CRIT","authz","non-member 'member' can GET a private board", str(r.status_code))
    # but can they read items via column-values? try bulk
    r = mem.post(f"{BASE}/column-values/upsert", json={"item_id": iid, "column_id": cols["Status"]["id"], "value":"X"})
    if r.status_code == 200: note("CRIT","authz","non-member can write column values to a private board")

# ── 7. move_to_group cross-board (suspected) ─────────────────────────────────
# create a 2nd board, try to move item into its group via PATCH move
if bid:
    r2 = admin.post(f"{BASE}/boards", json={"name": f"QA Board2 {rnd()}", "visibility":"private"})
    b2 = r2.json() if r2.status_code==201 else None
    if b2 and iid:
        g2 = b2["groups"][0]["id"]
        r = admin.patch(f"{BASE}/items/{iid}/move", json={"group_id": g2, "position": 0})
        if r.status_code == 200: note("BUG","integrity","item move accepted across boards via PATCH /move (cross-board move)", "should be blocked")

# ── 8. NEGATIVE / NONEXISTENT ids ────────────────────────────────────────────
r = admin.get(f"{BASE}/boards/99999999")
if r.status_code not in (403,404): note("BUG","robustness","GET nonexistent board not 404/403", str(r.status_code))
r = admin.post(f"{BASE}/items", json={"group_id": 99999999, "name":"x"})
if r.status_code not in (400,404): note("BUG","robustness","create item in nonexistent group not 404", str(r.status_code))
r = admin.post(f"{BASE}/items", json={"name":"no group"})
if r.status_code not in (400,): note("LOW","robustness","create item without group_id not 400", str(r.status_code))

# ── 9. DUPLICATE board name / empty name ─────────────────────────────────────
r = admin.post(f"{BASE}/boards", json={"name": "", "visibility":"private"})
if r.status_code == 201: note("MED","validation","board created with EMPTY name")
r = admin.post(f"{BASE}/items", json={"group_id": gid, "name": ""})
if r.status_code == 201: note("MED","validation","item created with EMPTY name")

# ── 10. SELF role/deactivate guard ───────────────────────────────────────────
r = admin.put(f"{BASE}/auth/users/1/role", json={"role":"user"})
if r.status_code == 200: note("BUG","authz","admin was able to change OWN role (lockout risk)")

# ── 11. Idempotent favorite ──────────────────────────────────────────────────
if bid:
    admin.post(f"{BASE}/boards/{bid}/favorite");
    r = admin.post(f"{BASE}/boards/{bid}/favorite")
    if r.status_code not in (200,): note("LOW","robustness","double-favorite not idempotent", str(r.status_code))

print("\n================ SUMMARY ================")
from collections import Counter
c = Counter(f[0] for f in findings)
print(dict(c))
print(f"Total findings: {len(findings)}")
