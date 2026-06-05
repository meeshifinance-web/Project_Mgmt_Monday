# -*- coding: utf-8 -*-
"""Round 2 QA: automation actions, comments, trash, concurrency, misc."""
import requests, random, string, threading, time
BASE="http://localhost:3001/api"
def rnd(n=5): return ''.join(random.choices(string.ascii_lowercase,k=n))
def note(s,a,t,d=""): print(f"[{s}] {a}: {t}  {('- '+d) if d else ''}")
S=requests.Session(); S.post(f"{BASE}/auth/login",json={"email":"admin@simplixart.com","password":"Admin@1234"})

# board + item + status col
b=S.post(f"{BASE}/boards",json={"name":f"QA2 {rnd()}","visibility":"private"}).json()
bid=b["id"]; gid=b["groups"][0]["id"]; status=[c for c in b["columns"] if c["type"]=="status"][0]
it=S.post(f"{BASE}/items",json={"group_id":gid,"name":"itm"}).json(); iid=it["id"]

# ── A. Column with bogus type ────────────────────────────────────────────────
r=S.post(f"{BASE}/columns",json={"board_id":bid,"title":"Weird","type":"not_a_real_type"})
if r.status_code==201: note("MED","columns","accepts unknown column type 'not_a_real_type' (renders as text)")

# ── B. bulk-upsert over the 100 limit ────────────────────────────────────────
r=S.post(f"{BASE}/column-values/bulk-upsert",json={"item_ids":list(range(1,200)),"column_id":status["id"],"value":"Done"})
if r.status_code!=400: note("LOW","bulk","bulk-upsert >100 not rejected",str(r.status_code))

# ── C. move_to_group automation pointing at ANOTHER board's group ─────────────
b2=S.post(f"{BASE}/boards",json={"name":f"QA2b {rnd()}","visibility":"private"}).json()
g2=b2["groups"][0]["id"]
auto={"board_id":bid,"name":"xboard move","trigger_type":"status_change",
      "trigger_config":{"column_id":status["id"],"to_value":"Done"},
      "action_type":"move_to_group","action_config":{"target_group_id":g2}}
ra=S.post(f"{BASE}/automations",json=auto)
if ra.status_code==201:
    # trigger it
    S.post(f"{BASE}/column-values/upsert",json={"item_id":iid,"column_id":status["id"],"value":"Done"})
    # check where the item ended up
    chk=S.get(f"{BASE}/boards/{bid}")
    found_in_b1=any(i["id"]==iid for grp in chk.json().get("groups",[]) for i in grp.get("items",[]))
    chk2=S.get(f"{BASE}/boards/{b2['id']}")
    found_in_b2=any(i["id"]==iid for grp in chk2.json().get("groups",[]) for i in grp.get("items",[]))
    if found_in_b2 and not found_in_b1:
        note("BUG","integrity","move_to_group automation moved item INTO ANOTHER BOARD (orphaned cross-board)","item now invisible on its origin board")

# fresh item for further tests
it=S.post(f"{BASE}/items",json={"group_id":gid,"name":"itm2"}).json(); iid=it["id"]

# ── D. Comment edge cases ────────────────────────────────────────────────────
r=S.post(f"{BASE}/comments",json={"item_id":iid,"board_id":bid,"body":""})
if r.status_code==201: note("LOW","comments","empty comment body accepted")
r=S.post(f"{BASE}/comments",json={"item_id":iid,"board_id":bid,"body":"hi","mentions":[999999]})
if r.status_code in (200,201): note("LOW","comments","mention of nonexistent user id accepted silently")
r=S.post(f"{BASE}/comments",json={"item_id":iid,"board_id":bid,"body":"A"*200000})
if r.status_code in (200,201): note("LOW","comments","no length cap on comment body (200k)")

# ── E. Trash: delete item then restore ───────────────────────────────────────
itd=S.post(f"{BASE}/items",json={"group_id":gid,"name":"todelete"}).json(); did=itd["id"]
S.post(f"{BASE}/column-values/upsert",json={"item_id":did,"column_id":status["id"],"value":"Stuck"})
S.delete(f"{BASE}/items/{did}")
tr=S.get(f"{BASE}/trash/board/{bid}")
if tr.status_code==200:
    rows=tr.json() if isinstance(tr.json(),list) else tr.json().get("items",[])
    match=[x for x in rows if x.get("item_id")==did or x.get("name")=="todelete"]
    if not match: note("MED","trash","deleted item not found in board trash list")
else:
    note("INFO","trash",f"trash list endpoint returned {tr.status_code}")

# ── F. Concurrency: 10 simultaneous edits to same cell (last-write / lost updates) ─
itc=S.post(f"{BASE}/items",json={"group_id":gid,"name":"concurrent"}).json(); cid=itc["id"]
results=[]
def edit(v):
    rr=S.post(f"{BASE}/column-values/upsert",json={"item_id":cid,"column_id":status["id"],"value":f"v{v}"})
    results.append(rr.status_code)
threads=[threading.Thread(target=edit,args=(i,)) for i in range(10)]
[t.start() for t in threads]; [t.join() for t in threads]
errs=[c for c in results if c>=500]
if errs: note("BUG","concurrency",f"{len(errs)}/10 concurrent same-cell edits returned 5xx (deadlock/race)")
else: note("OK","concurrency","10 concurrent same-cell edits handled (last-write-wins, no realtime merge)")

# ── G. Negative position move ────────────────────────────────────────────────
r=S.patch(f"{BASE}/items/{cid}/move",json={"group_id":gid,"position":-5})
if r.status_code>=500: note("BUG","robustness","negative position move caused 5xx")

# ── H. Subitem automations don't fire (expected gap) ─────────────────────────
sub=S.post(f"{BASE}/items",json={"group_id":gid,"name":"sub","parent_item_id":cid})
if sub.status_code==201: note("INFO","subitems","subitem created; note: item_created automations intentionally skip subitems")

# ── I. Delete board you don't own as manager already tested; test self-deactivate ─
r=S.put(f"{BASE}/auth/users/1/active",json={"is_active":False})
if r.status_code==200: note("BUG","authz","admin able to DEACTIVATE own account (lockout)")

# ── J. Create item under another user's private board group (IDOR via group id) ─
# (covered by canAccessBoard; quick re-confirm with second user omitted here)

print("\nround 2 complete")
