# -*- coding: utf-8 -*-
"""Rigorous end-to-end test of EVERY Simplix feature with realistic fake data.
Records PASS / FAIL / BUG per check. Exhaustive: auth -> multi-board -> items ->
columns -> automations -> forms -> dashboards -> collaboration -> permissions."""
import requests, random, string, json, time
BASE = "http://localhost:3001/api"
P=F=B=0
def rnd(n=5): return ''.join(random.choices(string.ascii_lowercase, k=n))
def check(cond, area, msg, sev="FAIL"):
    global P,F,B
    if cond: P+=1; #print(f"  pass: {area} {msg}")
    else:
        if sev=="BUG": B+=1
        else: F+=1
        print(f"  [{sev}] {area}: {msg}")
def sess(email,pw):
    s=requests.Session(); r=s.post(f"{BASE}/auth/login",json={"email":email,"password":pw})
    return s if r.status_code==200 else None

print("="*70); print("SECTION 1 — AUTHENTICATION"); print("="*70)
admin=sess("admin@simplixart.com","Admin@1234")
check(admin is not None,"auth","admin login")
check(requests.post(f"{BASE}/auth/login",json={"email":"admin@simplixart.com","password":"x"}).status_code==401,"auth","wrong password rejected")
check(requests.post(f"{BASE}/auth/login",json={"email":"nope@x.com","password":"x"}).status_code==401,"auth","unknown user rejected")
check(requests.get(f"{BASE}/boards").status_code==401,"auth","unauth blocked")
# register flow
regem=f"reg_{rnd()}@t.com"
rr=requests.post(f"{BASE}/auth/register",json={"email":regem,"password":"Passw0rd!23","name":"Reg User"})
check(rr.status_code in (200,201),"auth","self-register works")
check(requests.post(f"{BASE}/auth/register",json={"email":f"{rnd()}@t.com","password":"short","name":"x"}).status_code>=400,"auth","weak password blocked")
check(requests.post(f"{BASE}/auth/register",json={"email":regem,"password":"Passw0rd!23","name":"dup"}).status_code>=400,"auth","duplicate email blocked")
me=admin.get(f"{BASE}/auth/me"); check(me.status_code==200 and me.json().get("role")=="admin","auth","/me returns profile")
check(admin.post(f"{BASE}/auth/mfa/setup",json={}).status_code==200,"auth","MFA setup returns QR")
# create role users
users={}
for role in ["manager","member","user"]:
    em=f"{role}_{rnd()}@t.com"
    r=admin.post(f"{BASE}/auth/admin/create-user",json={"email":em,"password":"Passw0rd!23","name":f"QA {role.title()}","role":role})
    check(r.status_code==201,"auth",f"admin creates {role}")
    users[role]={"email":em,"id":r.json().get("id"),"sess":sess(em,"Passw0rd!23")}
check(admin.put(f"{BASE}/auth/users/1/role",json={"role":"user"}).status_code>=400,"auth","cannot change own role")
check(users["user"]["sess"].post(f"{BASE}/auth/admin/create-user",json={"email":"x@x.com","password":"Passw0rd!23","name":"x","role":"admin"}).status_code>=400,"auth","non-admin cannot create users")

print("="*70); print("SECTION 2 — MULTIPLE BOARDS + FAKE DATA"); print("="*70)
# Build 3 realistic boards
boards=[]
PROJECTS=["Marketing Q3","Product Launch","Hiring Pipeline"]
for nm in PROJECTS:
    r=admin.post(f"{BASE}/boards",json={"name":nm,"visibility":"private"})
    check(r.status_code==201,"boards",f"create '{nm}'")
    boards.append(r.json())
check(len(boards)==3,"boards","3 boards created")
b=boards[0]; bid=b["id"]; gid=b["groups"][0]["id"]
# add all column types
COLTYPES=["text","number","date","status","dropdown","person","checkbox","rating","progress","timeline","tags","email","phone","link","long_text","formula","file","color_picker","time_tracking","location","priority","creation_log"]
created_cols={}
for t in COLTYPES:
    r=admin.post(f"{BASE}/columns",json={"board_id":bid,"title":f"c_{t}","type":t})
    check(r.status_code==201,"columns",f"add {t} column")
    if r.status_code==201: created_cols[t]=r.json()
# reload board to get all columns
b=admin.get(f"{BASE}/boards/{bid}").json()
colmap={c["title"]:c for c in b["columns"]}
status_col=[c for c in b["columns"] if c["type"]=="status"][0]
num_col=created_cols.get("number")
date_col=created_cols.get("date")
person_col=[c for c in b["columns"] if c["type"]=="person"][0]
# add 3 more groups
group_ids=[gid]
for gn in ["Backlog","In Progress","Done"]:
    r=admin.post(f"{BASE}/groups",json={"board_id":bid,"name":gn,"color":"#"+rnd(6)[:6].replace('g','a').replace('h','b').replace('i','c').replace('j','d').replace('k','e').replace('l','f') if False else "#0073ea"})
    if r.status_code==201: group_ids.append(r.json()["id"])
check(len(group_ids)>=4,"groups","added multiple groups")
# create 30 items with varied fake data spread across groups
STATUSES=["Not Started","In Progress","Done","Stuck"]
NAMES=["Asha","Ben","Cara","Admin"]
item_ids=[]
for i in range(30):
    g=random.choice(group_ids)
    r=admin.post(f"{BASE}/items",json={"group_id":g,"name":f"Task {i+1} {rnd()}"})
    if r.status_code!=201: check(False,"items",f"create item {i}"); continue
    it=r.json(); item_ids.append(it["id"])
    admin.post(f"{BASE}/column-values/upsert",json={"item_id":it["id"],"column_id":status_col["id"],"value":random.choice(STATUSES)})
    if num_col: admin.post(f"{BASE}/column-values/upsert",json={"item_id":it["id"],"column_id":num_col["id"],"value":str(random.randint(10,5000))})
    if date_col: admin.post(f"{BASE}/column-values/upsert",json={"item_id":it["id"],"column_id":date_col["id"],"value":f"2026-0{random.randint(1,9)}-1{random.randint(0,9)}"})
check(len(item_ids)>=28,"items","created ~30 items with fake data")
# subitems
sr=admin.post(f"{BASE}/items",json={"group_id":gid,"name":"Parent w/ subs"})
parent=sr.json() if sr.status_code==201 else None
if parent:
    s1=admin.post(f"{BASE}/items",json={"group_id":gid,"name":"Subtask A","parent_item_id":parent["id"]})
    check(s1.status_code==201,"subitems","create subitem")
# item ops
if item_ids:
    cp=admin.post(f"{BASE}/items/{item_ids[0]}/copy"); check(cp.status_code==201,"items","duplicate item")
    rn=admin.put(f"{BASE}/items/{item_ids[1]}",json={"name":"Renamed task"}); check(rn.status_code==200,"items","rename item")
    mv=admin.patch(f"{BASE}/items/{item_ids[2]}/move",json={"group_id":group_ids[1],"position":0}); check(mv.status_code==200,"items","move item between groups")
# bulk update
bu=admin.post(f"{BASE}/column-values/bulk-upsert",json={"item_ids":item_ids[:10],"column_id":status_col["id"],"value":"Done"})
check(bu.status_code==200,"items","bulk update 10 items")

print("="*70); print("SECTION 3 — VALIDATION / DATA INTEGRITY"); print("="*70)
iid=item_ids[0]
if num_col:
    check(admin.post(f"{BASE}/column-values/upsert",json={"item_id":iid,"column_id":num_col["id"],"value":"banana"}).status_code==200,"validation","number col stores text 'banana' (Monday rejects)",sev="BUG")
if date_col:
    check(admin.post(f"{BASE}/column-values/upsert",json={"item_id":iid,"column_id":date_col["id"],"value":"2026-13-45"}).status_code==200,"validation","date col stores impossible date (Monday rejects)",sev="BUG")
check(admin.post(f"{BASE}/boards",json={"name":"","visibility":"private"}).status_code==201,"validation","empty board name accepted (Monday requires name)",sev="BUG")
check(admin.post(f"{BASE}/columns",json={"board_id":bid,"title":"Bad","type":"xyz"}).status_code==201,"validation","unknown column type accepted",sev="BUG")

print("="*70); print("SECTION 4 — AUTOMATIONS"); print("="*70)
# create + fire a status->assign automation
au=admin.post(f"{BASE}/automations",json={"board_id":bid,"name":"auto1","trigger_type":"status_change","trigger_config":{"column_id":status_col["id"],"to_value":"Stuck"},"action_type":"set_status","action_config":{"column_id":status_col["id"],"value":"Stuck"}})
check(au.status_code==201,"automations","create automation")
# fire item_created automation: set status on create
ic=admin.post(f"{BASE}/automations",json={"board_id":bid,"name":"oncreate","trigger_type":"item_created","trigger_config":{},"action_type":"set_status","action_config":{"column_id":status_col["id"],"value":"In Progress"}})
if ic.status_code==201:
    ni=admin.post(f"{BASE}/items",json={"group_id":gid,"name":"auto-status item"})
    nid=ni.json()["id"]
    nb=admin.get(f"{BASE}/boards/{bid}").json()
    found=None
    for g in nb["groups"]:
        for it in g["items"]:
            if it["id"]==nid: found=it
    check(found and found["values"].get(str(status_col["id"]))=="In Progress","automations","item_created automation actually fired (set status)")
# IDOR check
mgr=users["manager"]["sess"]
check(mgr.get(f"{BASE}/automations/board/{bid}").status_code==200,"automations","manager reads automations of board they're NOT a member of (IDOR - Monday blocks)",sev="BUG")

print("="*70); print("SECTION 5 — FORMS"); print("="*70)
fm=admin.post(f"{BASE}/boards/{bid}/forms",json={"title":"Intake Form"})
check(fm.status_code==201,"forms","create form")
if fm.status_code==201:
    form=fm.json(); slug=form["slug"]
    admin.put(f"{BASE}/forms/{form['id']}/fields",json={"fields":[{"column_id":status_col["id"],"label":"Status","is_required":False}]})
    check(requests.get(f"{BASE}/public/forms/{slug}").status_code==200,"forms","public form loads (no auth)")
    sub=requests.post(f"{BASE}/public/forms/{slug}/submit",json={"fields":{"_name":"Form Lead","%s"%status_col["id"]:"Done"}})
    check(sub.status_code==201,"forms","public submit creates item")

print("="*70); print("SECTION 6 — DASHBOARDS + WIDGETS"); print("="*70)
dd=admin.post(f"{BASE}/dashboards",json={"name":"Exec Dashboard"})
check(dd.status_code==201,"dashboards","create dashboard")
did=dd.json()["id"] if dd.status_code==201 else None
if did:
    widget_types=["kpi","chart","stacked_bar","battery","trend","workload","deadlines","summary","top_n","pivot","status_grid","quick_stats","funnel","gauge","burndown","calendar","leaderboard","heatmap","radar","treemap"]
    ok=0
    for wt in widget_types:
        cfg={"board_id":bid,"column_id":status_col["id"]}
        if wt in ("kpi","top_n") and num_col: cfg["column_id"]=num_col["id"]; cfg["sort_column"]=num_col["id"]
        if wt=="workload" or wt=="leaderboard": cfg["column_id"]=person_col["id"]; cfg["person_column"]=person_col["id"]
        if wt=="deadlines" or wt=="calendar": cfg["column_id"]=date_col["id"] if date_col else status_col["id"]
        if wt=="pivot": cfg["col_column_id"]=status_col["id"]
        if wt=="funnel": cfg["stages"]=STATUSES
        r=admin.post(f"{BASE}/dashboards/{did}/widgets",json={"type":wt,"config":cfg})
        if r.status_code==201: ok+=1
        else: check(False,"dashboards",f"add {wt} widget failed {r.status_code}")
    check(ok==len(widget_types),"dashboards",f"all {len(widget_types)} widget types added ({ok} ok)")
    wl=admin.get(f"{BASE}/dashboards/{did}/widgets"); check(wl.status_code==200,"dashboards","list widgets")

print("="*70); print("SECTION 7 — VIEWS / FOLDERS / FAVORITES / TRASH"); print("="*70)
v=admin.get(f"{BASE}/views/board/{bid}"); check(v.status_code==200,"views","auto-create main view")
nv=admin.post(f"{BASE}/views",json={"board_id":bid,"name":"Kanban","type":"kanban","filters":[]}); check(nv.status_code==201,"views","create kanban view (note: renders as table only)",sev="BUG")
fo=admin.post(f"{BASE}/folders",json={"name":"Q3 Folder"}); check(fo.status_code==201,"folders","create folder")
if fo.status_code==201:
    check(admin.put(f"{BASE}/boards/{bid}",json={"name":b["name"],"visibility":"private"}).status_code in (200,),"folders","board update ok")
fav=admin.post(f"{BASE}/boards/{bid}/favorite"); check(fav.status_code==200,"favorites","favorite board")
check(admin.delete(f"{BASE}/boards/{bid}/favorite").status_code==200,"favorites","unfavorite board")
# trash: delete + restore item
td=admin.post(f"{BASE}/items",json={"group_id":gid,"name":"trash me"}).json()
admin.delete(f"{BASE}/items/{td['id']}")
tr=admin.get(f"{BASE}/trash/board/{bid}")
check(tr.status_code==200,"trash","list board trash")
rows=tr.json() if isinstance(tr.json(),list) else []
if rows:
    rid=rows[0].get("id")
    check(admin.post(f"{BASE}/trash/{rid}/restore",json={}).status_code in (200,201),"trash","restore item")

print("="*70); print("SECTION 8 — COLLABORATION"); print("="*70)
cm=admin.post(f"{BASE}/comments",json={"item_id":iid,"board_id":bid,"body":"Looks good @team"})
check(cm.status_code in (200,201),"comments","post comment")
cid=cm.json().get("id") if cm.status_code<400 else None
if cid:
    check(admin.post(f"{BASE}/comments",json={"item_id":iid,"board_id":bid,"body":"reply","parent_id":cid}).status_code in (200,201),"comments","threaded reply")
check(admin.get(f"{BASE}/notifications").status_code==200,"notifications","list notifications")
check(admin.get(f"{BASE}/activity-logs/board/{bid}").status_code==200,"activity","board activity log")
al=admin.get(f"{BASE}/activity-logs/board/{bid}").json()
check(isinstance(al,list) and len(al)>0,"activity","activity log has entries")

print("="*70); print("SECTION 9 — SEARCH / MY WORK"); print("="*70)
check(admin.get(f"{BASE}/cmdk-search?q=Task").status_code==200,"search","command palette search works")
gs=admin.get(f"{BASE}/search?q=Task")
check(gs.status_code==200,"search","global /api/search works (currently 500 - BROKEN)",sev="BUG")
check(admin.get(f"{BASE}/my-work").status_code==200,"mywork","My Work loads")

print("="*70); print("SECTION 10 — PERMISSIONS / VISIBILITY"); print("="*70)
# member not on board cannot access
mem=users["member"]["sess"]
check(mem.get(f"{BASE}/boards/{bid}").status_code==403,"perms","non-member blocked from private board")
# make public and re-check
admin.put(f"{BASE}/boards/{bid}",json={"name":b["name"],"visibility":"org_wide"})
pub=mem.get(f"{BASE}/boards/{bid}")
check(pub.status_code==200,"perms","'Make Public' actually grants access (currently still 403 - BROKEN)",sev="BUG")
# read-only user cannot edit
admin.post(f"{BASE}/boards/{bid}/members",json={"email":users["user"]["email"]})
ro=users["user"]["sess"].post(f"{BASE}/column-values/upsert",json={"item_id":iid,"column_id":status_col["id"],"value":"Done"})
check(ro.status_code==403,"perms","read-only 'user' cannot edit values")

print("="*70); print("SECTION 11 — API KEYS / EXPORT"); print("="*70)
k=admin.post(f"{BASE}/keys",json={"name":"test key","scope":"read"})
check(k.status_code==201,"apikeys","create scoped API key")
check(admin.get(f"{BASE}/keys").status_code==200,"apikeys","list keys")
check(admin.get(f"{BASE}/boards/{bid}/export").status_code==200,"export","export board")

print("\n"+"="*70)
print(f"RESULTS:  PASS={P}   FAIL={F}   BUG(confirmed/known)={B}")
print("="*70)
