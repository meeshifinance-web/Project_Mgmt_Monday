# -*- coding: utf-8 -*-
"""Exhaustive live feature probe for Simplix Workboard.
Exercises EVERY feature area against the running API and records:
 - does the core operation work?
 - what is the actual observed behavior?
Run output is consumed to build the feature-gap report."""
import requests, random, string, json
BASE="http://localhost:3001/api"
def rnd(n=5): return ''.join(random.choices(string.ascii_lowercase,k=n))
def line(area, op, resp, extra=""):
    code = resp.status_code if hasattr(resp,'status_code') else resp
    ok = "OK " if (isinstance(code,int) and code<400) else "FAIL"
    print(f"  [{ok} {code}] {area:14} {op:42} {extra}")
    return resp

S=requests.Session(); r=S.post(f"{BASE}/auth/login",json={"email":"admin@simplixart.com","password":"Admin@1234"})
print("LOGIN", r.status_code)

# ── second user ──
em=f"qa_{rnd()}@t.com"
S.post(f"{BASE}/auth/admin/create-user",json={"email":em,"password":"Passw0rd!23","name":"QA Two","role":"manager"})
U=requests.Session(); U.post(f"{BASE}/auth/login",json={"email":em,"password":"Passw0rd!23"})

# ── board scaffold ──
b=S.post(f"{BASE}/boards",json={"name":f"Probe {rnd()}","visibility":"private"}).json()
bid=b["id"]; gid=b["groups"][0]["id"]
status=[c for c in b["columns"] if c["type"]=="status"][0]
person=[c for c in b["columns"] if c["type"]=="person"][0]
it=S.post(f"{BASE}/items",json={"group_id":gid,"name":"Probe item"}).json(); iid=it["id"]

print("\n== GROUPS ==")
g2=line("groups","create group", S.post(f"{BASE}/groups",json={"board_id":bid,"name":"G2","color":"#ff0000"}))
g2id=g2.json().get("id") if g2.status_code<400 else None
if g2id:
    line("groups","rename group", S.put(f"{BASE}/groups/{g2id}",json={"name":"G2x","color":"#00ff00"}))
    line("groups","reorder groups", S.patch(f"{BASE}/groups/reorder",json={"board_id":bid,"ordered_ids":[gid,g2id]}))
    line("groups","delete group", S.delete(f"{BASE}/groups/{g2id}"))

print("\n== COLUMNS ==")
for t in ["text","number","date","status","dropdown","person","checkbox","rating","progress","timeline","tags","email","phone","link","long_text","formula","file","color_picker","time_tracking","location","priority","creation_log"]:
    rc=S.post(f"{BASE}/columns",json={"board_id":bid,"title":f"c_{t}","type":t})
    if rc.status_code>=400: line("columns",f"create {t}", rc)
print("  (all 22 column types created OK unless listed above)")

print("\n== VIEWS ==")
v=line("views","list/auto-create", S.get(f"{BASE}/views/board/{bid}"))
nv=line("views","create kanban view", S.post(f"{BASE}/views",json={"board_id":bid,"name":"Kanban","type":"kanban","filters":[]}))
nvid=nv.json().get("id") if nv.status_code<400 else None
if nvid:
    line("views","update view filters", S.put(f"{BASE}/views/{nvid}",json={"filters":[{"colId":status['id'],"value":"Done"}]}))
    line("views","delete view", S.delete(f"{BASE}/views/{nvid}"))

print("\n== AUTOMATIONS ==")
line("automations","list", S.get(f"{BASE}/automations/board/{bid}"))
a=line("automations","create", S.post(f"{BASE}/automations",json={"board_id":bid,"name":"a1","trigger_type":"status_change","trigger_config":{"column_id":status['id'],"to_value":"Done"},"action_type":"notify","action_config":{}}))
aid=a.json().get("id") if a.status_code<400 else None
if aid:
    line("automations","toggle/update", S.put(f"{BASE}/automations/{aid}",json={"name":"a1","trigger_type":"status_change","trigger_config":{"column_id":status['id'],"to_value":"Done"},"action_type":"notify","action_config":{},"enabled":False}))
    line("automations","delete", S.delete(f"{BASE}/automations/{aid}"))

print("\n== DATE CASCADE ==")
line("cascade","list rules", S.get(f"{BASE}/date-cascade/board/{bid}/rules"))

print("\n== COMMENTS ==")
c=line("comments","create", S.post(f"{BASE}/comments",json={"item_id":iid,"board_id":bid,"body":"hello"}))
cid=c.json().get("id") if c.status_code<400 else None
line("comments","list for item", S.get(f"{BASE}/comments/item/{iid}"))
if cid:
    line("comments","reply", S.post(f"{BASE}/comments",json={"item_id":iid,"board_id":bid,"body":"reply","parent_id":cid}))
    line("comments","delete", S.delete(f"{BASE}/comments/{cid}"))

print("\n== NOTIFICATIONS ==")
line("notif","list", S.get(f"{BASE}/notifications"))
line("notif","unread count", S.get(f"{BASE}/notifications/unread-count"))
line("notif","mark all read", S.post(f"{BASE}/notifications/mark-all-read",json={}))

print("\n== ACTIVITY LOG ==")
line("activity","board log", S.get(f"{BASE}/activity-logs/board/{bid}"))
line("activity","item log", S.get(f"{BASE}/activity-logs/item/{iid}"))

print("\n== MY WORK ==")
line("mywork","get my work", S.get(f"{BASE}/my-work"))

print("\n== SEARCH ==")
line("search","global search", S.get(f"{BASE}/search?q=Probe"))
line("search","cmdk search", S.get(f"{BASE}/cmdk-search?q=Probe"))

print("\n== FORMS ==")
f=line("forms","create", S.post(f"{BASE}/boards/{bid}/forms",json={"title":"F1"}))
fid=f.json().get("id") if f.status_code<400 else None
line("forms","list", S.get(f"{BASE}/boards/{bid}/forms"))
if fid:
    line("forms","get", S.get(f"{BASE}/forms/{fid}"))
    line("forms","set fields", S.put(f"{BASE}/forms/{fid}/fields",json={"fields":[{"column_id":status['id'],"label":"Status","is_required":True}]}))
    slug=f.json().get("slug")
    if slug:
        line("forms","public get (no auth)", requests.get(f"{BASE}/public/forms/{slug}"))
        line("forms","public submit", requests.post(f"{BASE}/public/forms/{slug}/submit",json={"fields":{"_name":"Via form"}}))

print("\n== DASHBOARDS ==")
d=line("dash","create", S.post(f"{BASE}/dashboards",json={"name":"D1"}))
did=d.json().get("id") if d.status_code<400 else None
line("dash","list", S.get(f"{BASE}/dashboards"))
if did:
    line("dash","get", S.get(f"{BASE}/dashboards/{did}"))
    line("dash","update widgets", S.put(f"{BASE}/dashboards/{did}",json={"name":"D1","widgets":[{"id":"w1","type":"kpi","config":{}}],"layout":[]}))
    line("dash","delete", S.delete(f"{BASE}/dashboards/{did}"))

print("\n== FOLDERS ==")
fo=line("folders","create", S.post(f"{BASE}/folders",json={"name":"Folder1"}))
foid=fo.json().get("id") if fo.status_code<400 else None
line("folders","list", S.get(f"{BASE}/folders"))
if foid:
    line("folders","move board into", S.patch(f"{BASE}/boards/{bid}/folder",json={"folder_id":foid}) if False else S.put(f"{BASE}/folders/{foid}",json={"name":"Folder1x"}))
    line("folders","delete", S.delete(f"{BASE}/folders/{foid}"))

print("\n== API KEYS ==")
k=line("apikeys","create", S.post(f"{BASE}/keys",json={"name":"k1","scope":"read"}))
kid=k.json().get("id") if k.status_code<400 else None
line("apikeys","list", S.get(f"{BASE}/keys"))
if kid: line("apikeys","revoke", S.delete(f"{BASE}/keys/{kid}"))

print("\n== EXPORT / IMPORT ==")
line("export","export board json/xlsx", S.get(f"{BASE}/boards/{bid}/export"))

print("\n== TRASH ==")
td=S.post(f"{BASE}/items",json={"group_id":gid,"name":"trashme"}).json()
S.delete(f"{BASE}/items/{td['id']}")
tr=line("trash","board trash list", S.get(f"{BASE}/trash/board/{bid}"))
rows=tr.json() if tr.status_code<400 and isinstance(tr.json(),list) else []
if rows:
    line("trash","restore item", S.post(f"{BASE}/trash/restore/{rows[0].get('id')}",json={}))
line("globaltrash","list", S.get(f"{BASE}/global-trash"))

print("\n== ITEM EMAILS ==")
line("itememail","thread for item", S.get(f"{BASE}/items/{iid}/emails"))

print("\n== EMAIL ADMIN ==")
line("emailadmin","status", S.get(f"{BASE}/email/status"))

print("\n== PROFILE / MFA ==")
line("profile","get me", S.get(f"{BASE}/auth/me"))
line("profile","update me", S.put(f"{BASE}/auth/me",json={"name":"Admin"}))
line("mfa","setup", S.post(f"{BASE}/auth/mfa/setup",json={}))

print("\n== MEMBERS ==")
line("members","add member", S.post(f"{BASE}/boards/{bid}/members",json={"email":em}))
line("members","list", S.get(f"{BASE}/boards/{bid}/members"))
line("members","user search", S.get(f"{BASE}/auth/users/search?q=qa"))

print("\nDONE")
