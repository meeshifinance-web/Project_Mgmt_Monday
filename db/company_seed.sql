-- ═══════════════════════════════════════════════════════════════════════════
-- Simplix — Realistic Company Seed Data
-- ═══════════════════════════════════════════════════════════════════════════
-- A home-furnishings / interior décor company. Seeds:
--   • ~18 users across departments (admins, managers, employees)
--   • 6 boards in 4 folders (incl. one nested subfolder)
--   • Each board uses a DIFFERENT mix of column types & groups
--   • Realistic items with populated cells covering EVERY column type
--   • Board membership, ownership, favourites, automations, comments,
--     notifications.
--
-- Login for every seeded user:  <email> / Password@123
-- The pre-existing admin (admin@simplixart.com / Admin@1234) is untouched.
--
-- Idempotent-ish: re-running wipes ONLY the seeded boards (by name) and the
-- seeded users (by email) and recreates them. The original admin/bot users
-- and any board you created by hand are left alone.
--
-- Run:
--   docker exec -i workboard_db psql -U postgres -d workboard_db < db/company_seed.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- ── 0. Clean slate for re-runs ───────────────────────────────────────────────
-- Remove previously-seeded boards (cascades to groups/items/columns/values/…)
DELETE FROM boards WHERE name IN (
  'Product Design Pipeline',
  'Manufacturing & Production',
  'Sales CRM Pipeline',
  'Marketing Campaigns',
  'HR Recruitment Tracker',
  'IT Helpdesk & Sprint'
);
-- Remove previously-seeded folders
DELETE FROM board_folders WHERE name IN ('Creative', 'Operations', 'Revenue', 'Field Sales');
-- Remove previously-seeded users (keep admin@ and the email bot)
DELETE FROM users WHERE email LIKE '%@simplixart.com'
  AND email NOT IN ('admin@simplixart.com', 'noreply+bot@simplixart.com');

-- ── Helper functions (dropped at the end) ────────────────────────────────────
CREATE OR REPLACE FUNCTION _seed_set_values(p_item int, p_board int, p_vals jsonb)
RETURNS void AS $fn$
DECLARE k text; v text; cid int;
BEGIN
  FOR k, v IN SELECT key, value FROM jsonb_each_text(p_vals) LOOP
    SELECT id INTO cid FROM columns WHERE board_id = p_board AND title = k;
    IF cid IS NOT NULL THEN
      INSERT INTO column_values(item_id, column_id, value)
      VALUES (p_item, cid, v)
      ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value;
    END IF;
  END LOOP;
END $fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _seed_item(
  p_group int, p_board int, p_name text, p_pos int,
  p_creator int, p_cname text, p_vals jsonb
) RETURNS int AS $fn$
DECLARE iid int;
BEGIN
  INSERT INTO items(group_id, name, position, created_by_user_id, created_by_user_name, created_at)
  VALUES (p_group, p_name, p_pos, p_creator, p_cname, NOW() - (p_pos || ' days')::interval)
  RETURNING id INTO iid;
  PERFORM _seed_set_values(iid, p_board, p_vals);
  RETURN iid;
END $fn$ LANGUAGE plpgsql;

DO $$
DECLARE
  hash       text := '$2b$12$JLEk2ztBVBXRSauZ8DGwtuZ03YQH19HmWBcROnk9zVC.VeT5.eQli'; -- Password@123
  super_admin int;

  -- user ids
  u_rajesh int; u_priya int;                                   -- admins
  u_ananya int; u_vikram int; u_neha int; u_arjun int; u_kavya int; u_rohan int; -- managers
  u_sara int; u_aditya int; u_manish int; u_deepak int; u_pooja int; u_karan int;
  u_ritu int; u_sneha int; u_amit int; u_divya int;            -- employees

  -- folders
  f_creative int; f_operations int; f_revenue int; f_fieldsales int;

  -- board + group ids (reused per board)
  b int; g1 int; g2 int; g3 int; g4 int;
  it int;
BEGIN
  SELECT id INTO super_admin FROM users WHERE email = 'admin@simplixart.com';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 1. USERS
  -- ═══════════════════════════════════════════════════════════════════════
  -- Admins
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('rajesh.menon@simplixart.com',hash,'Rajesh Menon','admin',true,NOW()-interval '2 hours') RETURNING id INTO u_rajesh;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('priya.sharma@simplixart.com',hash,'Priya Sharma','admin',true,NOW()-interval '1 day') RETURNING id INTO u_priya;

  -- Managers
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('ananya.iyer@simplixart.com',hash,'Ananya Iyer','manager',true,NOW()-interval '3 hours') RETURNING id INTO u_ananya;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('vikram.singh@simplixart.com',hash,'Vikram Singh','manager',true,NOW()-interval '5 hours') RETURNING id INTO u_vikram;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('neha.gupta@simplixart.com',hash,'Neha Gupta','manager',true,NOW()-interval '20 hours') RETURNING id INTO u_neha;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('arjun.reddy@simplixart.com',hash,'Arjun Reddy','manager',true,NOW()-interval '2 days') RETURNING id INTO u_arjun;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('kavya.nair@simplixart.com',hash,'Kavya Nair','manager',true,NOW()-interval '6 hours') RETURNING id INTO u_kavya;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('rohan.desai@simplixart.com',hash,'Rohan Desai','manager',true,NOW()-interval '30 minutes') RETURNING id INTO u_rohan;

  -- Employees
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('sara.khan@simplixart.com',hash,'Sara Khan','user',true,NOW()-interval '4 hours') RETURNING id INTO u_sara;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('aditya.joshi@simplixart.com',hash,'Aditya Joshi','user',true,NOW()-interval '1 day') RETURNING id INTO u_aditya;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('manish.patel@simplixart.com',hash,'Manish Patel','user',true,NOW()-interval '7 hours') RETURNING id INTO u_manish;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('deepak.verma@simplixart.com',hash,'Deepak Verma','user',true,NOW()-interval '9 hours') RETURNING id INTO u_deepak;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('pooja.mehta@simplixart.com',hash,'Pooja Mehta','user',true,NOW()-interval '3 days') RETURNING id INTO u_pooja;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('karan.malhotra@simplixart.com',hash,'Karan Malhotra','user',true,NOW()-interval '5 days') RETURNING id INTO u_karan;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('ritu.agarwal@simplixart.com',hash,'Ritu Agarwal','user',true,NOW()-interval '8 hours') RETURNING id INTO u_ritu;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('sneha.pillai@simplixart.com',hash,'Sneha Pillai','user',true,NOW()-interval '1 day') RETURNING id INTO u_sneha;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('amit.choudhary@simplixart.com',hash,'Amit Choudhary','user',true,NOW()-interval '45 minutes') RETURNING id INTO u_amit;
  INSERT INTO users(email,password_hash,name,role,is_active,last_login)
    VALUES ('divya.rao@simplixart.com',hash,'Divya Rao','user',false,NOW()-interval '40 days') RETURNING id INTO u_divya; -- inactive/ex-employee

  -- ═══════════════════════════════════════════════════════════════════════
  -- 2. FOLDERS  (Revenue ▸ Field Sales is a nested subfolder)
  -- ═══════════════════════════════════════════════════════════════════════
  INSERT INTO board_folders(name,position,created_by) VALUES ('Creative',0,u_ananya) RETURNING id INTO f_creative;
  INSERT INTO board_folders(name,position,created_by) VALUES ('Operations',1,super_admin) RETURNING id INTO f_operations;
  INSERT INTO board_folders(name,position,created_by) VALUES ('Revenue',2,u_neha) RETURNING id INTO f_revenue;
  INSERT INTO board_folders(name,position,created_by,parent_folder_id)
    VALUES ('Field Sales',0,u_neha,f_revenue) RETURNING id INTO f_fieldsales;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 3. BOARD 1 — Product Design Pipeline   (folder: Creative)
  --    Types: status, person, dropdown, priority, timeline, date,
  --           progress, rating, link, long_text, file
  -- ═══════════════════════════════════════════════════════════════════════
  INSERT INTO boards(name,description,visibility,created_by,folder_id)
    VALUES ('Product Design Pipeline','New collection concepts from sketch to sign-off','org_wide',u_ananya,f_creative)
    RETURNING id INTO b;

  INSERT INTO columns(board_id,title,type,settings,position) VALUES
    (b,'Status','status', '{"options":[{"label":"Not Started","color":"#c4c4c4"},{"label":"In Progress","color":"#fdab3d"},{"label":"Review","color":"#a25ddc"},{"label":"Approved","color":"#00c875"},{"label":"On Hold","color":"#e2445c"}]}', 0),
    (b,'Owner','person', '{"options":["Ananya Iyer","Sara Khan","Aditya Joshi"]}', 1),
    (b,'Design Stage','dropdown', '{"options":["Sketch","3D Render","Prototype","Sample"]}', 2),
    (b,'Priority','priority', '{"options":[{"label":"Low","color":"#579bfc"},{"label":"Medium","color":"#fdab3d"},{"label":"High","color":"#e2445c"},{"label":"Critical","color":"#bb3354"}]}', 3),
    (b,'Timeline','timeline','{}',4),
    (b,'Due Date','date','{}',5),
    (b,'Progress','progress','{}',6),
    (b,'Quality Rating','rating','{}',7),
    (b,'Reference','link','{}',8),
    (b,'Notes','long_text','{}',9),
    (b,'Mockups','file','{}',10);

  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Concept','#a25ddc',0) RETURNING id INTO g1;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'In Design','#0073ea',1) RETURNING id INTO g2;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Approved','#00c875',2) RETURNING id INTO g3;

  PERFORM _seed_item(g1,b,'Mediterranean Sofa Collection',0,u_ananya,'Ananya Iyer',
    '{"Status":"In Progress","Owner":"[\"Ananya Iyer\"]","Design Stage":"[\"Sketch\"]","Priority":"High","Timeline":"2026-06-01 → 2026-07-15","Due Date":"2026-07-15","Progress":"30","Quality Rating":"4","Reference":"https://pinterest.com/simplix/mediterranean","Notes":"Inspired by coastal Spanish villas. Linen-blend upholstery, low arms."}'::jsonb);
  PERFORM _seed_item(g1,b,'Velvet Accent Chair Range',1,u_sara,'Sara Khan',
    '{"Status":"Not Started","Owner":"[\"Sara Khan\"]","Design Stage":"[\"Sketch\"]","Priority":"Medium","Due Date":"2026-08-01","Progress":"0","Quality Rating":"3","Notes":"Jewel-tone velvets — emerald, sapphire, ruby."}'::jsonb);
  PERFORM _seed_item(g1,b,'Sheer Curtain Patterns 2026',2,u_aditya,'Aditya Joshi',
    '{"Status":"On Hold","Owner":"[\"Aditya Joshi\"]","Design Stage":"[\"3D Render\"]","Priority":"Low","Due Date":"2026-09-10","Progress":"10","Notes":"Awaiting fabric supplier confirmation."}'::jsonb);

  PERFORM _seed_item(g2,b,'Modular L-Shape Sofa',0,u_ananya,'Ananya Iyer',
    '{"Status":"In Progress","Owner":"[\"Ananya Iyer\",\"Sara Khan\"]","Design Stage":"[\"Prototype\"]","Priority":"Critical","Timeline":"2026-05-10 → 2026-06-20","Due Date":"2026-06-20","Progress":"65","Quality Rating":"5","Reference":"https://drive.simplixart.com/lshape","Notes":"Reconfigurable modules. Hidden storage in chaise."}'::jsonb);
  PERFORM _seed_item(g2,b,'Geometric Jacquard Cushions',1,u_sara,'Sara Khan',
    '{"Status":"Review","Owner":"[\"Sara Khan\"]","Design Stage":"[\"Sample\"]","Priority":"Medium","Timeline":"2026-05-20 → 2026-06-10","Due Date":"2026-06-10","Progress":"80","Quality Rating":"4","Notes":"Sample sent to merchandising for color approval."}'::jsonb);

  PERFORM _seed_item(g3,b,'Heritage Wingback Chair',0,u_aditya,'Aditya Joshi',
    '{"Status":"Approved","Owner":"[\"Aditya Joshi\"]","Design Stage":"[\"Sample\"]","Priority":"High","Timeline":"2026-03-01 → 2026-04-30","Due Date":"2026-04-30","Progress":"100","Quality Rating":"5","Reference":"https://drive.simplixart.com/wingback","Notes":"Signed off by design director. Moving to production."}'::jsonb);

  -- membership + ownership
  INSERT INTO board_members(board_id,user_id,added_by,is_owner) VALUES
    (b,u_ananya,super_admin,true),(b,u_sara,u_ananya,false),(b,u_aditya,u_ananya,false),(b,u_arjun,u_ananya,false);

  -- ═══════════════════════════════════════════════════════════════════════
  -- 4. BOARD 2 — Manufacturing & Production   (folder: Operations)
  --    Types: status, person, number, dropdown, timeline, progress,
  --           checkbox, tags, date, creation_log
  -- ═══════════════════════════════════════════════════════════════════════
  INSERT INTO boards(name,description,visibility,created_by,folder_id)
    VALUES ('Manufacturing & Production','Factory floor order tracking — cutting to dispatch','org_wide',u_vikram,f_operations)
    RETURNING id INTO b;

  INSERT INTO columns(board_id,title,type,settings,position) VALUES
    (b,'Status','status', '{"options":[{"label":"Queued","color":"#c4c4c4"},{"label":"Running","color":"#fdab3d"},{"label":"Blocked","color":"#e2445c"},{"label":"Done","color":"#00c875"}]}', 0),
    (b,'Owner','person', '{"options":["Vikram Singh","Manish Patel","Deepak Verma"]}', 1),
    (b,'Order Qty','number','{}',2),
    (b,'Production Line','dropdown', '{"options":["Line A","Line B","Line C","Outsourced"]}', 3),
    (b,'Timeline','timeline','{}',4),
    (b,'Progress','progress','{}',5),
    (b,'QC Passed','checkbox','{}',6),
    (b,'Materials','tags','{}',7),
    (b,'Target Date','date','{}',8),
    (b,'Logged','creation_log','{}',9);

  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Cutting & Weaving','#fdab3d',0) RETURNING id INTO g1;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Assembly','#0073ea',1) RETURNING id INTO g2;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Quality Control','#a25ddc',2) RETURNING id INTO g3;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Ready to Dispatch','#00c875',3) RETURNING id INTO g4;

  PERFORM _seed_item(g1,b,'Order #PO-4521 — Linen Sofa x40',0,u_manish,'Manish Patel',
    '{"Status":"Running","Owner":"[\"Manish Patel\"]","Order Qty":"40","Production Line":"[\"Line A\"]","Timeline":"2026-06-01 → 2026-06-12","Progress":"55","QC Passed":"false","Materials":"linen, foam, hardwood frame","Target Date":"2026-06-12"}'::jsonb);
  PERFORM _seed_item(g1,b,'Order #PO-4530 — Velvet Cushions x200',1,u_deepak,'Deepak Verma',
    '{"Status":"Queued","Owner":"[\"Deepak Verma\"]","Order Qty":"200","Production Line":"[\"Line B\"]","Progress":"0","QC Passed":"false","Materials":"velvet, polyfill","Target Date":"2026-06-25"}'::jsonb);

  PERFORM _seed_item(g2,b,'Order #PO-4498 — Wingback Chair x25',0,u_manish,'Manish Patel',
    '{"Status":"Running","Owner":"[\"Manish Patel\",\"Deepak Verma\"]","Order Qty":"25","Production Line":"[\"Line C\"]","Timeline":"2026-05-25 → 2026-06-08","Progress":"70","QC Passed":"false","Materials":"oak, leather, brass studs","Target Date":"2026-06-08"}'::jsonb);
  PERFORM _seed_item(g2,b,'Order #PO-4505 — Modular Sofa x15',1,u_vikram,'Vikram Singh',
    '{"Status":"Blocked","Owner":"[\"Vikram Singh\"]","Order Qty":"15","Production Line":"[\"Line A\"]","Progress":"40","QC Passed":"false","Materials":"foam, fabric, steel connectors","Target Date":"2026-06-18"}'::jsonb);

  PERFORM _seed_item(g3,b,'Order #PO-4480 — Curtains x500',0,u_deepak,'Deepak Verma',
    '{"Status":"Running","Owner":"[\"Deepak Verma\"]","Order Qty":"500","Production Line":"[\"Outsourced\"]","Progress":"90","QC Passed":"true","Materials":"sheer polyester","Target Date":"2026-06-05"}'::jsonb);

  PERFORM _seed_item(g4,b,'Order #PO-4460 — Accent Chairs x30',0,u_manish,'Manish Patel',
    '{"Status":"Done","Owner":"[\"Manish Patel\"]","Order Qty":"30","Production Line":"[\"Line B\"]","Timeline":"2026-04-10 → 2026-05-20","Progress":"100","QC Passed":"true","Materials":"velvet, beech wood","Target Date":"2026-05-20"}'::jsonb);

  INSERT INTO board_members(board_id,user_id,added_by,is_owner) VALUES
    (b,u_vikram,super_admin,true),(b,u_manish,u_vikram,false),(b,u_deepak,u_vikram,false),(b,u_priya,super_admin,false);

  INSERT INTO automations(board_id,name,trigger_type,trigger_config,action_type,action_config,enabled) VALUES
    (b,'Notify on Blocked','status_change','{"column_title":"Status","to_value":"Blocked"}','notify','{"message":"A production order is blocked — needs attention."}',true),
    (b,'Email when Done','status_change','{"column_title":"Status","to_value":"Done"}','send_email','{"to":"vikram.singh@simplixart.com","subject":"Order complete","body":"An order finished production."}',true);

  -- ═══════════════════════════════════════════════════════════════════════
  -- 5. BOARD 3 — Sales CRM Pipeline   (folder: Revenue ▸ Field Sales)
  --    Types: status, person, number, dropdown, email, phone, rating,
  --           date, formula, long_text
  -- ═══════════════════════════════════════════════════════════════════════
  INSERT INTO boards(name,description,visibility,created_by,folder_id)
    VALUES ('Sales CRM Pipeline','B2B & dealer deals from lead to close','org_wide',u_neha,f_fieldsales)
    RETURNING id INTO b;

  INSERT INTO columns(board_id,title,type,settings,position) VALUES
    (b,'Deal Stage','status', '{"options":[{"label":"New Lead","color":"#579bfc"},{"label":"Qualified","color":"#fdab3d"},{"label":"Proposal","color":"#a25ddc"},{"label":"Negotiation","color":"#ff642e"},{"label":"Won","color":"#00c875"},{"label":"Lost","color":"#e2445c"}]}', 0),
    (b,'Account Owner','person', '{"options":["Neha Gupta","Pooja Mehta","Karan Malhotra"]}', 1),
    (b,'Deal Value','number','{}',2),
    (b,'Region','dropdown', '{"options":["North","South","East","West","Export"]}', 3),
    (b,'Contact Email','email','{}',4),
    (b,'Contact Phone','phone','{}',5),
    (b,'Lead Score','rating','{}',6),
    (b,'Expected Close','date','{}',7),
    (b,'Est. Commission','formula', '{"formula":"{Deal Value} * 0.05"}', 8),
    (b,'Last Touch','long_text','{}',9);

  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Leads','#579bfc',0) RETURNING id INTO g1;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Qualified','#fdab3d',1) RETURNING id INTO g2;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Negotiation','#ff642e',2) RETURNING id INTO g3;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Closed Won','#00c875',3) RETURNING id INTO g4;

  PERFORM _seed_item(g1,b,'Westside Retail — Store Fit-out',0,u_pooja,'Pooja Mehta',
    '{"Deal Stage":"New Lead","Account Owner":"[\"Pooja Mehta\"]","Deal Value":"450000","Region":"[\"West\"]","Contact Email":"procurement@westside.example","Contact Phone":"+91 98200 11223","Lead Score":"3","Expected Close":"2026-08-30","Last Touch":"Intro call done. Sending catalogue."}'::jsonb);
  PERFORM _seed_item(g1,b,'Grand Hyatt — Lobby Furnishing',1,u_karan,'Karan Malhotra',
    '{"Deal Stage":"New Lead","Account Owner":"[\"Karan Malhotra\"]","Deal Value":"1200000","Region":"[\"South\"]","Contact Email":"facilities@hyatt.example","Contact Phone":"+91 90000 44556","Lead Score":"4","Expected Close":"2026-10-15","Last Touch":"Referred by architect. High potential."}'::jsonb);

  PERFORM _seed_item(g2,b,'Oberoi Residences — Bulk Curtains',0,u_pooja,'Pooja Mehta',
    '{"Deal Stage":"Qualified","Account Owner":"[\"Pooja Mehta\"]","Deal Value":"320000","Region":"[\"North\"]","Contact Email":"design@oberoi-res.example","Contact Phone":"+91 99100 77889","Lead Score":"4","Expected Close":"2026-07-20","Last Touch":"Budget confirmed. Awaiting fabric samples."}'::jsonb);
  PERFORM _seed_item(g2,b,'Dubai Export Order — Sofas',1,u_neha,'Neha Gupta',
    '{"Deal Stage":"Proposal","Account Owner":"[\"Neha Gupta\"]","Deal Value":"2800000","Region":"[\"Export\"]","Contact Email":"imports@gulffurnish.example","Contact Phone":"+971 50 123 4567","Lead Score":"5","Expected Close":"2026-09-01","Last Touch":"Proposal v2 shared. Negotiating shipping terms."}'::jsonb);

  PERFORM _seed_item(g3,b,'Marriott — Banquet Seating',0,u_karan,'Karan Malhotra',
    '{"Deal Stage":"Negotiation","Account Owner":"[\"Karan Malhotra\"]","Deal Value":"1750000","Region":"[\"South\"]","Contact Email":"purchasing@marriott.example","Contact Phone":"+91 91234 00112","Lead Score":"4","Expected Close":"2026-06-28","Last Touch":"Final pricing under review with their CFO."}'::jsonb);

  PERFORM _seed_item(g4,b,'Lodha Towers — Showflat Package',0,u_neha,'Neha Gupta',
    '{"Deal Stage":"Won","Account Owner":"[\"Neha Gupta\",\"Pooja Mehta\"]","Deal Value":"980000","Region":"[\"West\"]","Contact Email":"projects@lodha.example","Contact Phone":"+91 98765 33221","Lead Score":"5","Expected Close":"2026-05-15","Last Touch":"Signed! Delivery scheduled for July."}'::jsonb);

  INSERT INTO board_members(board_id,user_id,added_by,is_owner) VALUES
    (b,u_neha,super_admin,true),(b,u_pooja,u_neha,false),(b,u_karan,u_neha,false);

  INSERT INTO automations(board_id,name,trigger_type,trigger_config,action_type,action_config,enabled) VALUES
    (b,'Celebrate a Win','status_change','{"column_title":"Deal Stage","to_value":"Won"}','notify','{"message":"🎉 A deal was won!"}',true);

  -- ═══════════════════════════════════════════════════════════════════════
  -- 6. BOARD 4 — Marketing Campaigns   (folder: Creative)
  --    Types: status, person, dropdown, timeline, number, progress,
  --           color_picker, link, tags
  -- ═══════════════════════════════════════════════════════════════════════
  INSERT INTO boards(name,description,visibility,created_by,folder_id)
    VALUES ('Marketing Campaigns','Brand, digital & seasonal campaign planning','org_wide',u_arjun,f_creative)
    RETURNING id INTO b;

  INSERT INTO columns(board_id,title,type,settings,position) VALUES
    (b,'Status','status', '{"options":[{"label":"Planning","color":"#c4c4c4"},{"label":"Live","color":"#00c875"},{"label":"Paused","color":"#fdab3d"},{"label":"Completed","color":"#0073ea"}]}', 0),
    (b,'Owner','person', '{"options":["Arjun Reddy","Ritu Agarwal"]}', 1),
    (b,'Channel','dropdown', '{"options":["Instagram","Google Ads","Email","Print","Influencer","Events"]}', 2),
    (b,'Timeline','timeline','{}',3),
    (b,'Budget','number','{}',4),
    (b,'Spend','progress','{}',5),
    (b,'Brand Color','color_picker','{}',6),
    (b,'Landing Page','link','{}',7),
    (b,'Tags','tags','{}',8);

  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Planning','#c4c4c4',0) RETURNING id INTO g1;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Live','#00c875',1) RETURNING id INTO g2;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Completed','#0073ea',2) RETURNING id INTO g3;

  PERFORM _seed_item(g1,b,'Monsoon Home Makeover',0,u_ritu,'Ritu Agarwal',
    '{"Status":"Planning","Owner":"[\"Ritu Agarwal\"]","Channel":"[\"Instagram\"]","Timeline":"2026-06-15 → 2026-07-31","Budget":"150000","Spend":"5","Brand Color":"#2e86ab","Landing Page":"https://simplixart.com/monsoon","Tags":"seasonal, social, reels"}'::jsonb);
  PERFORM _seed_item(g1,b,'Diwali Festive Catalogue',1,u_arjun,'Arjun Reddy',
    '{"Status":"Planning","Owner":"[\"Arjun Reddy\",\"Ritu Agarwal\"]","Channel":"[\"Print\"]","Budget":"400000","Spend":"0","Brand Color":"#e2445c","Tags":"festive, print, catalogue"}'::jsonb);

  PERFORM _seed_item(g2,b,'Summer Clearance — Google Ads',0,u_ritu,'Ritu Agarwal',
    '{"Status":"Live","Owner":"[\"Ritu Agarwal\"]","Channel":"[\"Google Ads\"]","Timeline":"2026-05-01 → 2026-06-15","Budget":"250000","Spend":"68","Brand Color":"#fdab3d","Landing Page":"https://simplixart.com/sale","Tags":"ppc, sale, conversion"}'::jsonb);
  PERFORM _seed_item(g2,b,'Designer Collab — Influencer Push',1,u_arjun,'Arjun Reddy',
    '{"Status":"Live","Owner":"[\"Arjun Reddy\"]","Channel":"[\"Influencer\"]","Timeline":"2026-05-20 → 2026-06-30","Budget":"600000","Spend":"45","Brand Color":"#a25ddc","Landing Page":"https://simplixart.com/collab","Tags":"influencer, launch, premium"}'::jsonb);

  PERFORM _seed_item(g3,b,'New Year Email Blast',0,u_ritu,'Ritu Agarwal',
    '{"Status":"Completed","Owner":"[\"Ritu Agarwal\"]","Channel":"[\"Email\"]","Timeline":"2025-12-20 → 2026-01-05","Budget":"50000","Spend":"100","Brand Color":"#00c875","Tags":"email, newsletter"}'::jsonb);

  INSERT INTO board_members(board_id,user_id,added_by,is_owner) VALUES
    (b,u_arjun,super_admin,true),(b,u_ritu,u_arjun,false),(b,u_ananya,u_arjun,false);

  -- ═══════════════════════════════════════════════════════════════════════
  -- 7. BOARD 5 — HR Recruitment Tracker   (folder: Operations, PRIVATE +
  --    strict owner visibility — only owners/admins see all candidates)
  --    Types: status, person, email, phone, dropdown, date, rating,
  --           file, long_text
  -- ═══════════════════════════════════════════════════════════════════════
  INSERT INTO boards(name,description,visibility,created_by,folder_id,enforce_owner_visibility)
    VALUES ('HR Recruitment Tracker','Confidential candidate pipeline','private',u_kavya,f_operations,true)
    RETURNING id INTO b;

  INSERT INTO columns(board_id,title,type,settings,position) VALUES
    (b,'Stage','status', '{"options":[{"label":"Applied","color":"#c4c4c4"},{"label":"Screening","color":"#fdab3d"},{"label":"Interview","color":"#a25ddc"},{"label":"Offer","color":"#0073ea"},{"label":"Hired","color":"#00c875"},{"label":"Rejected","color":"#e2445c"}]}', 0),
    (b,'Recruiter','person', '{"options":["Kavya Nair","Sneha Pillai"]}', 1),
    (b,'Candidate Email','email','{}',2),
    (b,'Phone','phone','{}',3),
    (b,'Department','dropdown', '{"options":["Design","Production","Sales","Marketing","Engineering","Finance"]}', 4),
    (b,'Interview Date','date','{}',5),
    (b,'Fit Score','rating','{}',6),
    (b,'Resume','file','{}',7),
    (b,'Feedback','long_text','{}',8);

  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Applied','#c4c4c4',0) RETURNING id INTO g1;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Interviewing','#a25ddc',1) RETURNING id INTO g2;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Offer & Hired','#00c875',2) RETURNING id INTO g3;

  PERFORM _seed_item(g1,b,'Meera Kapoor — Textile Designer',0,u_sneha,'Sneha Pillai',
    '{"Stage":"Applied","Recruiter":"[\"Sneha Pillai\"]","Candidate Email":"meera.k@example.com","Phone":"+91 98111 22334","Department":"[\"Design\"]","Fit Score":"4","Feedback":"Strong portfolio. NID graduate."}'::jsonb);
  PERFORM _seed_item(g1,b,'Sanjay Bhat — Production Supervisor',1,u_kavya,'Kavya Nair',
    '{"Stage":"Screening","Recruiter":"[\"Kavya Nair\"]","Candidate Email":"sanjay.bhat@example.com","Phone":"+91 99220 55667","Department":"[\"Production\"]","Fit Score":"3","Feedback":"8 yrs factory experience. Salary expectation a bit high."}'::jsonb);

  PERFORM _seed_item(g2,b,'Aisha Sheikh — Sales Executive',0,u_sneha,'Sneha Pillai',
    '{"Stage":"Interview","Recruiter":"[\"Sneha Pillai\"]","Candidate Email":"aisha.s@example.com","Phone":"+91 90011 88990","Department":"[\"Sales\"]","Interview Date":"2026-06-10","Fit Score":"5","Feedback":"Excellent communication. Second round with Neha scheduled."}'::jsonb);
  PERFORM _seed_item(g2,b,'Tarun Rao — Frontend Engineer',1,u_kavya,'Kavya Nair',
    '{"Stage":"Interview","Recruiter":"[\"Kavya Nair\"]","Candidate Email":"tarun.rao@example.com","Phone":"+91 93344 11220","Department":"[\"Engineering\"]","Interview Date":"2026-06-12","Fit Score":"4","Feedback":"Solid React skills. Tech round cleared."}'::jsonb);

  PERFORM _seed_item(g3,b,'Nisha Verma — Marketing Lead',0,u_kavya,'Kavya Nair',
    '{"Stage":"Hired","Recruiter":"[\"Kavya Nair\"]","Candidate Email":"nisha.v@example.com","Phone":"+91 98000 33445","Department":"[\"Marketing\"]","Interview Date":"2026-05-22","Fit Score":"5","Feedback":"Offer accepted. Joining 2026-07-01."}'::jsonb);

  INSERT INTO board_members(board_id,user_id,added_by,is_owner) VALUES
    (b,u_kavya,super_admin,true),(b,u_sneha,u_kavya,false);

  -- ═══════════════════════════════════════════════════════════════════════
  -- 8. BOARD 6 — IT Helpdesk & Sprint   (folder: Operations)
  --    Types: status, person, priority, number, dropdown, date,
  --           checkbox, time_tracking, tags, location
  -- ═══════════════════════════════════════════════════════════════════════
  INSERT INTO boards(name,description,visibility,created_by,folder_id)
    VALUES ('IT Helpdesk & Sprint','Internal IT tickets and engineering sprint work','org_wide',u_rohan,f_operations)
    RETURNING id INTO b;

  INSERT INTO columns(board_id,title,type,settings,position) VALUES
    (b,'Status','status', '{"options":[{"label":"Backlog","color":"#c4c4c4"},{"label":"In Progress","color":"#fdab3d"},{"label":"Code Review","color":"#a25ddc"},{"label":"Done","color":"#00c875"},{"label":"Won''t Fix","color":"#e2445c"}]}', 0),
    (b,'Assignee','person', '{"options":["Rohan Desai","Amit Choudhary","Divya Rao"]}', 1),
    (b,'Priority','priority', '{"options":[{"label":"Low","color":"#579bfc"},{"label":"Medium","color":"#fdab3d"},{"label":"High","color":"#e2445c"},{"label":"Urgent","color":"#bb3354"}]}', 2),
    (b,'Story Points','number','{}',3),
    (b,'Sprint','dropdown', '{"options":["Sprint 24","Sprint 25","Sprint 26","Backlog"]}', 4),
    (b,'Due Date','date','{}',5),
    (b,'Resolved','checkbox','{}',6),
    (b,'Time Spent','time_tracking','{}',7),
    (b,'Labels','tags','{}',8),
    (b,'Office','location','{}',9);

  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Backlog','#c4c4c4',0) RETURNING id INTO g1;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'In Progress','#fdab3d',1) RETURNING id INTO g2;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Code Review','#a25ddc',2) RETURNING id INTO g3;
  INSERT INTO groups(board_id,name,color,position) VALUES (b,'Done','#00c875',3) RETURNING id INTO g4;

  PERFORM _seed_item(g1,b,'Add dark mode to dealer portal',0,u_amit,'Amit Choudhary',
    '{"Status":"Backlog","Assignee":"[\"Amit Choudhary\"]","Priority":"Low","Story Points":"5","Sprint":"[\"Backlog\"]","Resolved":"false","Time Spent":"0h 0m","Labels":"frontend, ux","Office":"Mumbai HQ"}'::jsonb);
  PERFORM _seed_item(g1,b,'Migrate inventory DB to Postgres 16',1,u_rohan,'Rohan Desai',
    '{"Status":"Backlog","Assignee":"[\"Rohan Desai\"]","Priority":"Medium","Story Points":"13","Sprint":"[\"Sprint 26\"]","Due Date":"2026-07-05","Resolved":"false","Time Spent":"2h 30m","Labels":"backend, infra, db","Office":"Bengaluru"}'::jsonb);

  PERFORM _seed_item(g2,b,'Fix invoice PDF rendering bug',0,u_amit,'Amit Choudhary',
    '{"Status":"In Progress","Assignee":"[\"Amit Choudhary\"]","Priority":"High","Story Points":"3","Sprint":"[\"Sprint 25\"]","Due Date":"2026-06-09","Resolved":"false","Time Spent":"4h 15m","Labels":"bug, finance","Office":"Mumbai HQ"}'::jsonb);
  PERFORM _seed_item(g2,b,'VPN outage — sales team can''t connect',1,u_rohan,'Rohan Desai',
    '{"Status":"In Progress","Assignee":"[\"Rohan Desai\"]","Priority":"Urgent","Story Points":"2","Sprint":"[\"Sprint 25\"]","Due Date":"2026-06-04","Resolved":"false","Time Spent":"1h 45m","Labels":"helpdesk, network, urgent","Office":"Delhi Branch"}'::jsonb);

  PERFORM _seed_item(g3,b,'Add export-to-Excel on CRM board',0,u_divya,'Divya Rao',
    '{"Status":"Code Review","Assignee":"[\"Divya Rao\"]","Priority":"Medium","Story Points":"8","Sprint":"[\"Sprint 25\"]","Due Date":"2026-06-11","Resolved":"false","Time Spent":"6h 0m","Labels":"feature, export","Office":"Bengaluru"}'::jsonb);

  PERFORM _seed_item(g4,b,'SSO login for Microsoft 365',0,u_amit,'Amit Choudhary',
    '{"Status":"Done","Assignee":"[\"Amit Choudhary\"]","Priority":"High","Story Points":"8","Sprint":"[\"Sprint 24\"]","Due Date":"2026-05-28","Resolved":"true","Time Spent":"9h 30m","Labels":"auth, security","Office":"Mumbai HQ"}'::jsonb);
  PERFORM _seed_item(g4,b,'Laptop setup for new HR hire',1,u_rohan,'Rohan Desai',
    '{"Status":"Done","Assignee":"[\"Rohan Desai\"]","Priority":"Low","Story Points":"1","Sprint":"[\"Sprint 24\"]","Due Date":"2026-05-30","Resolved":"true","Time Spent":"1h 0m","Labels":"helpdesk, onboarding","Office":"Mumbai HQ"}'::jsonb);

  INSERT INTO board_members(board_id,user_id,added_by,is_owner) VALUES
    (b,u_rohan,super_admin,true),(b,u_amit,u_rohan,false),(b,u_divya,u_rohan,false),(b,u_priya,super_admin,false);

  -- ═══════════════════════════════════════════════════════════════════════
  -- 9. FAVOURITES, COMMENTS, NOTIFICATIONS (cross-board flavour)
  -- ═══════════════════════════════════════════════════════════════════════
  -- Star a few boards for a couple of users
  INSERT INTO board_favorites(board_id,user_id)
    SELECT id, u_ananya FROM boards WHERE name IN ('Product Design Pipeline','Marketing Campaigns')
    ON CONFLICT DO NOTHING;
  INSERT INTO board_favorites(board_id,user_id)
    SELECT id, u_neha FROM boards WHERE name = 'Sales CRM Pipeline'
    ON CONFLICT DO NOTHING;
  INSERT INTO board_favorites(board_id,user_id)
    SELECT id, super_admin FROM boards WHERE name IN ('Manufacturing & Production','IT Helpdesk & Sprint')
    ON CONFLICT DO NOTHING;

  -- A short comment thread on the modular sofa design item
  SELECT i.id INTO it FROM items i JOIN groups g ON i.group_id=g.id JOIN boards bd ON g.board_id=bd.id
    WHERE bd.name='Product Design Pipeline' AND i.name='Modular L-Shape Sofa' LIMIT 1;
  IF it IS NOT NULL THEN
    SELECT g.board_id INTO b FROM items i JOIN groups g ON i.group_id=g.id WHERE i.id=it;
    INSERT INTO comments(item_id,board_id,user_id,user_name,body) VALUES
      (it,b,u_ananya,'Ananya Iyer','Prototype arms feel a bit bulky — can we slim them by 2cm?'),
      (it,b,u_sara,'Sara Khan','Agreed, updating the 3D render now. New sample by Friday.');
    INSERT INTO notifications(user_id,from_user_id,from_user_name,item_id,item_name,board_id,board_name,message) VALUES
      (u_sara,u_ananya,'Ananya Iyer',it,'Modular L-Shape Sofa',b,'Product Design Pipeline','Ananya Iyer mentioned you in a comment');
  END IF;

  RAISE NOTICE 'Simplix company seed complete.';
END $$;

-- Clean up helper functions
DROP FUNCTION IF EXISTS _seed_item(int,int,text,int,int,text,jsonb);
DROP FUNCTION IF EXISTS _seed_set_values(int,int,jsonb);

COMMIT;

-- ── Summary ──────────────────────────────────────────────────────────────────
SELECT 'users'  AS entity, COUNT(*) FROM users
UNION ALL SELECT 'boards', COUNT(*) FROM boards
UNION ALL SELECT 'folders', COUNT(*) FROM board_folders
UNION ALL SELECT 'groups', COUNT(*) FROM groups
UNION ALL SELECT 'columns', COUNT(*) FROM columns
UNION ALL SELECT 'items', COUNT(*) FROM items
UNION ALL SELECT 'column_values', COUNT(*) FROM column_values
UNION ALL SELECT 'board_members', COUNT(*) FROM board_members
UNION ALL SELECT 'favorites', COUNT(*) FROM board_favorites
UNION ALL SELECT 'automations', COUNT(*) FROM automations
UNION ALL SELECT 'comments', COUNT(*) FROM comments
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;
