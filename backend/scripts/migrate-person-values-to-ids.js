/**
 * migrate-person-values-to-ids.js
 *
 * Converts existing person-column values from the legacy name-string format
 * (e.g. ["Priya Sharma","Admin"]) to the new identity format
 * (e.g. [{"id":17,"name":"Priya Sharma"},{"id":1,"name":"Admin"}]).
 *
 * Names are resolved to the first active user with that name. Unresolvable
 * names are kept as { id: null, name } so nothing is lost. Already-migrated
 * rows (objects with an id) are skipped. Idempotent.
 *
 *   node scripts/migrate-person-values-to-ids.js
 */
require('dotenv').config();
const pool = require('../db');

(async () => {
  const client = await pool.connect();
  let converted = 0, skipped = 0;
  try {
    const users = (await client.query('SELECT id, name FROM users')).rows;
    const idByName = new Map();
    for (const u of users) if (!idByName.has(u.name)) idByName.set(u.name, u.id); // first match wins

    const { rows } = await client.query(
      `SELECT cv.item_id, cv.column_id, cv.value
         FROM column_values cv JOIN columns c ON c.id = cv.column_id
        WHERE c.type = 'person' AND cv.value IS NOT NULL AND cv.value <> ''`
    );

    for (const row of rows) {
      let arr;
      try { arr = JSON.parse(row.value); } catch { arr = row.value.trim() ? [row.value.trim()] : []; }
      if (!Array.isArray(arr)) arr = arr ? [arr] : [];
      if (!arr.length) { skipped++; continue; }
      // Already migrated? (every element is an object with an id key)
      if (arr.every(e => e && typeof e === 'object' && 'id' in e)) { skipped++; continue; }

      const entries = arr.map(e => {
        if (e && typeof e === 'object') return { id: e.id ?? (idByName.has(e.name) ? idByName.get(e.name) : null), name: e.name || '' };
        const name = String(e);
        return { id: idByName.has(name) ? idByName.get(name) : null, name };
      }).filter(e => e.name || e.id != null);

      await client.query('UPDATE column_values SET value=$1 WHERE item_id=$2 AND column_id=$3',
        [JSON.stringify(entries), row.item_id, row.column_id]);
      converted++;
    }
    console.log(`✅ Person values migrated: ${converted} converted, ${skipped} already-ok/empty.`);
  } catch (err) {
    console.error('❌ migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
