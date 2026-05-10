require('dotenv').config();
const pool = require('./index');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    // Seed admin user in its own commit (independent of board seed)
    const adminHash = await bcrypt.hash('Admin@1234', 12);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ('admin@simplixart.com', $1, 'Admin', 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [adminHash]
    );
    console.log('✅ Default admin: admin@simplixart.com / Admin@1234');

    await client.query('BEGIN');

    // Check if board data already exists
    const { rows } = await client.query('SELECT COUNT(*) FROM boards');
    if (parseInt(rows[0].count) > 0) {
      console.log('Board seed data already exists, skipping.');
      await client.query('ROLLBACK');
      return;
    }

    // Create board
    const boardRes = await client.query(
      "INSERT INTO boards (name, description) VALUES ('D''Decor Project Board', 'Main project tracking board') RETURNING id"
    );
    const boardId = boardRes.rows[0].id;

    // Create columns
    const columns = [
      { title: 'Status', type: 'status', settings: { options: [{ label: 'Not Started', color: '#c4c4c4' }, { label: 'In Progress', color: '#fdab3d' }, { label: 'Done', color: '#00c875' }, { label: 'Stuck', color: '#e2445c' }, { label: 'Review', color: '#a25ddc' }] }, position: 0 },
      { title: 'Owner', type: 'person', settings: {}, position: 1 },
      { title: 'Due Date', type: 'date', settings: {}, position: 2 },
      { title: 'Priority', type: 'dropdown', settings: { options: ['Low', 'Medium', 'High', 'Critical'] }, position: 3 },
      { title: 'Progress', type: 'progress', settings: {}, position: 4 },
      { title: 'Notes', type: 'long_text', settings: {}, position: 5 },
    ];

    const colIds = [];
    for (const col of columns) {
      const r = await client.query(
        'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [boardId, col.title, col.type, JSON.stringify(col.settings), col.position]
      );
      colIds.push(r.rows[0].id);
    }

    // Create groups
    const groups = [
      { name: 'Design Phase', color: '#0073ea', position: 0 },
      { name: 'Production', color: '#00c875', position: 1 },
      { name: 'Dispatch', color: '#fdab3d', position: 2 },
    ];

    for (const grp of groups) {
      const gRes = await client.query(
        'INSERT INTO groups (board_id, name, color, position) VALUES ($1,$2,$3,$4) RETURNING id',
        [boardId, grp.name, grp.color, grp.position]
      );
      const groupId = gRes.rows[0].id;

      // Create items per group
      const itemNames = grp.name === 'Design Phase'
        ? ['Sofa Collection Designs', 'Curtain Patterns Q2', 'Color Palette Review']
        : grp.name === 'Production'
        ? ['Upholstery Fabric Weaving', 'Quality Check Batch 1', 'Dye Testing']
        : ['Shipment to Delhi Warehouse', 'Export Order #4521', 'Local Delivery Run'];

      for (let i = 0; i < itemNames.length; i++) {
        const iRes = await client.query(
          'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3) RETURNING id',
          [groupId, itemNames[i], i]
        );
        const itemId = iRes.rows[0].id;

        // Seed some column values
        const values = [
          'In Progress', 'Anupam Kumar', '2026-04-15', 'High', '45', 'Working on it',
        ];
        for (let j = 0; j < colIds.length; j++) {
          await client.query(
            'INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)',
            [itemId, colIds[j], values[j] || '']
          );
        }
      }
    }

    // Create a sample automation
    await client.query(
      `INSERT INTO automations (board_id, name, trigger_type, trigger_config, action_type, action_config, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        boardId,
        'Notify on Status Done',
        'status_change',
        JSON.stringify({ column_title: 'Status', to_value: 'Done' }),
        'send_email',
        JSON.stringify({ to: 'manager@simplixart.com', subject: 'Item marked Done', body: 'An item has been marked as Done on the board.' }),
        true,
      ]
    );

    await client.query('COMMIT');
    console.log('✅ Seed data inserted successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
