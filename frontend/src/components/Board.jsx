import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react'; // lazy/Suspense kept for ActivityLogPanel
import { useVirtualizer } from '@tanstack/react-virtual';
import ColumnCell, { parseOwners } from './ColumnCell';
import AddColumnModal from './AddColumnModal';
import StatusOptionsEditor from './StatusOptionsEditor';
import TrashPanel from './TrashPanel';
import BoardMembersPanel from './BoardMembersPanel';
import DefaultValueEditor from './DefaultValueEditor';
import ItemDetailPanel from './ItemDetailPanel';
import FormulaEditor from './FormulaEditor';
import {
  createGroup, updateGroup, deleteGroup, reorderGroups,
  createItem, updateItem, deleteItem, copyItem, moveItem,
  createColumn, updateColumn, deleteColumn, reorderColumns,
  upsertColumnValue, updateBoard, updateBoardEmailSettings,
  getTrashItems, getAutomations,
  exportBoard, importBoardRows,
  getBoardViews, createView, updateView, deleteView,
} from '../api';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

const ActivityLogPanel = lazy(() => import('./ActivityLogPanel'));

const GROUP_COLORS = ['#0073ea', '#00c875', '#fdab3d', '#e2445c', '#a25ddc', '#037f4c', '#ff5ac4', '#784bd1'];

// Simple CSV parser: returns array of objects keyed by header row
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const parseLine = (line) => {
    const fields = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields.map(f => f.trim());
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

// ── Import Preview Modal ───────────────────────────────────────────────────────
function ImportPreviewModal({ csvRows, boardColumns, boardGroups, onConfirm, onCancel }) {
  const headers = csvRows.length > 0 ? Object.keys(csvRows[0]) : [];

  // Count how many board columns share each lowercased title (detect duplicates)
  const titleCount = {};
  for (const c of boardColumns) {
    const k = c.title.toLowerCase();
    titleCount[k] = (titleCount[k] || 0) + 1;
  }
  // First-match map (same logic as the backend)
  const colByTitle = {};
  for (const c of boardColumns) {
    const k = c.title.toLowerCase();
    if (!colByTitle[k]) colByTitle[k] = c;
  }

  // Column types that the backend skips during import
  const SKIP_TYPES = new Set(['person', 'formula', 'creation_log']);

  // Classify every CSV header
  const mapping = headers.map(h => {
    const lh = h.toLowerCase();
    if (lh === 'group') return { header: h, kind: 'special', label: 'Swimlane / Group' };
    if (lh === 'item name' || lh === 'name') return { header: h, kind: 'special', label: 'Item Name (required)' };
    const col = colByTitle[lh];
    const isDup = titleCount[lh] > 1;
    const isSkipped = col && SKIP_TYPES.has(col.type);
    return { header: h, kind: col ? (isSkipped ? 'skipped' : 'matched') : 'unmatched', col, isDup };
  });

  const unmatchedHeaders = mapping.filter(m => m.kind === 'unmatched');
  const dupHeaders = mapping.filter(m => m.kind === 'matched' && m.isDup);
  const hasItemName = headers.some(h => ['item name', 'name'].includes(h.toLowerCase()));

  // Board columns absent from the CSV
  const missingBoardCols = boardColumns.filter(
    c => !headers.some(h => h.toLowerCase() === c.title.toLowerCase())
  );

  // Board-level duplicate titles (independent of CSV)
  const dupBoardTitles = [...new Set(
    boardColumns.filter(c => titleCount[c.title.toLowerCase()] > 1).map(c => c.title)
  )];

  // Groups in CSV that don't yet exist on the board → will be auto-created
  const existingGroupNames = new Set((boardGroups || []).map(g => g.name.toLowerCase()));
  const newGroups = [...new Set(
    csvRows
      .map(r => (r['Group'] || r['group'] || '').trim())
      .filter(g => g && !existingGroupNames.has(g.toLowerCase()))
  )];

  const hasBlocker = !hasItemName;
  const preview = csvRows.slice(0, 4);

  const S = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal: { background: '#fff', borderRadius: 10, width: 720, maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.22)' },
    header: { padding: '18px 24px 14px', borderBottom: '1px solid #e6e9ef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    body: { padding: '18px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 },
    footer: { padding: '14px 24px', borderTop: '1px solid #e6e9ef', display: 'flex', justifyContent: 'flex-end', gap: 10 },
    section: { display: 'flex', flexDirection: 'column', gap: 8 },
    sectionTitle: { fontSize: 12, fontWeight: 700, color: '#676879', letterSpacing: '0.5px', textTransform: 'uppercase' },
    badge: (color, bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, color, background: bg }),
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
    th: { padding: '6px 10px', background: '#f5f6f8', borderBottom: '1px solid #e6e9ef', textAlign: 'left', fontWeight: 700, color: '#676879', fontSize: 11 },
    td: { padding: '6px 10px', borderBottom: '1px solid #f0f1f4', verticalAlign: 'top' },
    alertBox: (color, bg) => ({ padding: '10px 14px', borderRadius: 7, background: bg, border: `1px solid ${color}`, display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }),
    btn: (primary) => ({
      padding: '7px 20px', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer',
      border: primary ? 'none' : '1.5px solid #e6e9ef',
      background: primary ? '#0073ea' : '#fff',
      color: primary ? '#fff' : '#676879',
    }),
    btnDanger: { padding: '7px 20px', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none', background: '#e2445c', color: '#fff' },
  };

  return (
    <div style={S.overlay} onClick={onCancel}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={S.header}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Import Preview</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#676879' }}>{csvRows.length} row{csvRows.length !== 1 ? 's' : ''} detected</span>
            <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#676879', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* ── Blockers ── */}
          {!hasItemName && (
            <div style={S.alertBox('#c9372c', '#fff5f4')}>
              <span style={{ fontSize: 16 }}>🚫</span>
              <div>
                <strong>Blocked:</strong> The CSV has no <em>"Item Name"</em> column.
                Please add a column header named exactly <code>Item Name</code> and re-upload.
              </div>
            </div>
          )}

          {/* ── Column mapping table ── */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Column Mapping</div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>CSV Header</th>
                  <th style={S.th}>Board Column</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {mapping.map((m, i) => (
                  <tr key={i}>
                    <td style={S.td}><code style={{ background: '#f5f6f8', padding: '1px 6px', borderRadius: 4 }}>{m.header}</code></td>
                    <td style={S.td}>
                      {m.kind === 'special' ? <em style={{ color: '#676879' }}>{m.label}</em>
                        : m.kind === 'matched' || m.kind === 'skipped' ? <span>{m.col.title} <span style={{ color: '#676879', fontSize: 11 }}>({m.col.type})</span></span>
                          : <span style={{ color: '#888' }}>—</span>}
                    </td>
                    <td style={S.td}>
                      {m.kind === 'special' && (
                        <span style={S.badge('#037f4c', '#e8f7ee')}>✓ Required field</span>
                      )}
                      {m.kind === 'skipped' && (
                        <span style={S.badge('#676879', '#f0f1f4')}>⊘ Not imported ({m.col.type} columns are set manually)</span>
                      )}
                      {m.kind === 'matched' && !m.isDup && (
                        <span style={S.badge('#037f4c', '#e8f7ee')}>✓ Matched</span>
                      )}
                      {m.kind === 'matched' && m.isDup && (
                        <span style={S.badge('#b05e00', '#fff4e5')}>⚠ Matched (duplicate title on board)</span>
                      )}
                      {m.kind === 'unmatched' && (
                        <span style={S.badge('#c9372c', '#fff5f4')}>✗ No matching column — will be ignored</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Board columns absent from CSV ── */}
          {missingBoardCols.length > 0 && (
            <div style={S.alertBox('#c9a227', '#fffbe6')}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <div>
                <strong>{missingBoardCols.length} board column{missingBoardCols.length > 1 ? 's' : ''} not in CSV</strong>
                {' — '}these will be imported as <em>empty</em>:{' '}
                {missingBoardCols.map(c => <code key={c.id} style={{ background: '#fff3cd', padding: '1px 5px', borderRadius: 3, marginRight: 4 }}>{c.title}</code>)}
              </div>
            </div>
          )}

          {/* ── Duplicate board column titles ── */}
          {dupBoardTitles.length > 0 && (
            <div style={S.alertBox('#c9a227', '#fffbe6')}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <div>
                <strong>Duplicate column titles on this board:</strong>{' '}
                {dupBoardTitles.map(t => <code key={t} style={{ background: '#fff3cd', padding: '1px 5px', borderRadius: 3, marginRight: 4 }}>{t}</code>)}.
                Only the first column with each title will receive imported values.
              </div>
            </div>
          )}

          {/* ── Unmatched CSV headers ── */}
          {unmatchedHeaders.length > 0 && (
            <div style={S.alertBox('#e6e9ef', '#f8f8fa')}>
              <span style={{ fontSize: 16 }}>ℹ️</span>
              <div>
                <strong>{unmatchedHeaders.length} CSV header{unmatchedHeaders.length > 1 ? 's' : ''} don't match any board column</strong>
                {' — '}their data will be <em>skipped</em>:{' '}
                {unmatchedHeaders.map(m => <code key={m.header} style={{ background: '#eee', padding: '1px 5px', borderRadius: 3, marginRight: 4 }}>{m.header}</code>)}
              </div>
            </div>
          )}

          {/* ── New groups that will be auto-created ── */}
          {newGroups.length > 0 && (
            <div style={S.alertBox('#0073ea33', '#e8f0fe')}>
              <span style={{ fontSize: 16 }}>🆕</span>
              <div>
                <strong>{newGroups.length} new group{newGroups.length > 1 ? 's' : ''} will be created</strong>
                {' (not found on board): '}
                {newGroups.map(g => <code key={g} style={{ background: '#d0e4ff', padding: '1px 5px', borderRadius: 3, marginRight: 4 }}>{g}</code>)}
              </div>
            </div>
          )}

          {/* ── Data preview ── */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Data Preview (first {preview.length} rows)</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ ...S.table, minWidth: 400 }}>
                <thead>
                  <tr>
                    {headers.map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>
                      {headers.map(h => (
                        <td key={h} style={{ ...S.td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row[h] || <span style={{ color: '#c5c7d0' }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {csvRows.length > 4 && (
              <div style={{ fontSize: 12, color: '#676879' }}>…and {csvRows.length - 4} more row{csvRows.length - 4 !== 1 ? 's' : ''}</div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button style={S.btn(false)} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...S.btn(true), opacity: hasBlocker ? 0.5 : 1, cursor: hasBlocker ? 'not-allowed' : 'pointer' }}
            disabled={hasBlocker}
            onClick={() => !hasBlocker && onConfirm()}
          >
            Import {csvRows.length} Row{csvRows.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function fireAutomations(triggered, toast) {
  for (const auto of triggered) {
    const acfg = typeof auto.action_config === 'string'
      ? JSON.parse(auto.action_config)
      : (auto.action_config || {});
    // send_email is now handled server-side — no mailto: needed
    if (auto.action_type === 'notify') {
      toast(acfg.message || `Automation: ${auto.name}`, 'info');
    }
  }
}

// ── Inline text edit ──────────────────────────────────────────────────────────
function InlineEdit({ value, onSave, style, placeholder, singleClick = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
        type="text"
        style={{ border: '1.5px solid #0073ea', borderRadius: 4, padding: '2px 6px', outline: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)', fontWeight: 'inherit', fontSize: 'inherit', width: '100%', boxSizing: 'border-box' }}
      />
    );
  }

  const trigger = singleClick
    ? { onClick: () => { setDraft(value); setEditing(true); } }
    : { onDoubleClick: () => { setDraft(value); setEditing(true); } };

  return (
    <span {...trigger} style={{ cursor: 'text', userSelect: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style }}
      title={singleClick ? 'Click to rename' : 'Double-click to rename'}>
      {value || <span style={{ color: '#c5c7d0' }}>{placeholder}</span>}
    </span>
  );
}

// ── Column header ─────────────────────────────────────────────────────────────
const NO_DEFAULT_TYPES = ['formula', 'creation_log'];

const CHANGEABLE_TYPES = [
  { value: 'text', label: 'Text', icon: '📝' },
  { value: 'long_text', label: 'Long Text', icon: '📄' },
  { value: 'number', label: 'Number', icon: '🔢' },
  { value: 'email', label: 'Email', icon: '✉️' },
  { value: 'phone', label: 'Phone', icon: '📞' },
  { value: 'link', label: 'Link', icon: '🔗' },
  { value: 'date', label: 'Date', icon: '📅' },
  { value: 'checkbox', label: 'Checkbox', icon: '☑️' },
  { value: 'rating', label: 'Rating', icon: '⭐' },
  { value: 'status', label: 'Status', icon: '🔵' },
  { value: 'dropdown', label: 'Dropdown', icon: '🗃️' },
  { value: 'progress', label: 'Progress', icon: '📊' },
  { value: 'tags', label: 'Tags', icon: '🏷️' },
  { value: 'timeline', label: 'Timeline', icon: '📆' },
  { value: 'color_picker', label: 'Color', icon: '🎨' },
  { value: 'formula', label: 'Formula', icon: '🧮' },
];

function ColumnHeader({ col, onRename, onDelete, onEditStatus, onEditFormula, onChangeType, onSetDefault, onToggleVisibility, isManager, sortConfig, onSort }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [renamePos, setRenamePos] = useState({ top: 0, left: 0, width: 280 });
  const menuRef = useRef(null);
  const btnRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)) {
        setMenuOpen(false);
        setShowTypePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Open menu with viewport-aware fixed positioning (never clips off screen)
  const openMenu = (e) => {
    e.stopPropagation();
    if (menuOpen) { setMenuOpen(false); return; }
    const rect = (btnRef.current || e.currentTarget).getBoundingClientRect();
    const menuW = 200;
    let left = rect.right - menuW;
    if (left < 8) left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    const top = rect.bottom + 4;
    setMenuPos({ top, left: Math.max(8, left) });
    setMenuOpen(true);
  };

  const startRename = (e) => {
    e?.stopPropagation();
    setMenuOpen(false);
    setDraftTitle(col.title);
    // Compute floating input position from the <th> bounding rect
    const th = btnRef.current?.closest('th') || btnRef.current;
    if (th) {
      const rect = th.getBoundingClientRect();
      const inputW = Math.max(280, rect.width + 60);
      let left = rect.left;
      if (left + inputW > window.innerWidth - 12) left = window.innerWidth - inputW - 12;
      setRenamePos({ top: rect.bottom + 6, left: Math.max(8, left), width: inputW });
    }
    setRenaming(true);
  };

  const commitRename = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== col.title) onRename(col.id, trimmed);
    setRenaming(false);
  };

  const handleSetDefault = (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (btnRef.current) {
      onSetDefault(col, btnRef.current.closest('th').getBoundingClientRect());
    }
  };

  const handleEditStatus = (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    onEditStatus(col);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    onDelete(col.id);
  };

  const handleToggleVisibility = (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    onToggleVisibility(col.id);
  };

  const showMenu = isManager || col.type === 'status';

  const menuItem = (onClick, children, danger) => (
    <div
      onClick={onClick}
      style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: danger ? '#e2445c' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 9 }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? 'rgba(226,68,92,0.08)' : 'var(--hover-bg)'}
      onMouseLeave={e => e.currentTarget.style.background = ''}
    >{children}</div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative', minWidth: 0 }}>

      {/* Title — always visible; double-click or use menu to rename */}
      <span
        title={col.title}
        onDoubleClick={isManager ? startRename : undefined}
        style={{
          flex: 1, minWidth: 0,
          fontSize: 12, fontWeight: 700,
          color: renaming ? '#0073ea' : '#676879',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          cursor: 'default', userSelect: 'none',
          fontStyle: renaming ? 'italic' : 'normal',
        }}
      >{col.title}{sortConfig?.colId === col.id && (
        <span style={{ marginLeft: 3, fontSize: 10, color: '#0073ea', fontWeight: 900 }}>
          {sortConfig.dir === 'asc' ? '↑' : '↓'}
        </span>
      )}</span>

      {/* Floating rename panel — fixed position, readable size, never clipped */}
      {renaming && (
        <div
          style={{
            position: 'fixed',
            top: renamePos.top,
            left: renamePos.left,
            width: renamePos.width,
            zIndex: 10000,
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
            border: '2px solid #0073ea',
            padding: '12px 14px 10px',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div style={{ fontSize: 11, color: '#9699a6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
            Rename column
          </div>
          <input
            autoFocus
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            onClick={e => e.stopPropagation()}
            onFocus={e => e.currentTarget.select()}
            style={{
              width: '100%', boxSizing: 'border-box',
              fontSize: 15, fontWeight: 600, color: '#323338',
              border: '1.5px solid #c4c7d0', borderRadius: 6,
              padding: '8px 12px', outline: 'none', background: '#fafbfc',
              transition: 'border-color 0.15s',
            }}
            onFocusCapture={e => { e.currentTarget.style.borderColor = '#0073ea'; e.currentTarget.style.background = '#fff'; }}
            onBlurCapture={e => { e.currentTarget.style.borderColor = '#c4c7d0'; }}
          />
          <div style={{ fontSize: 11, color: '#9699a6', marginTop: 7, textAlign: 'right' }}>
            ↵ Enter to save &nbsp;·&nbsp; Esc to cancel
          </div>
        </div>
      )}

      {/* Lock badge */}
      {col.type === 'person' && col.settings?.isOwnerColumn && (
        <span title="Visibility Control active" style={{ fontSize: 10, color: '#0073ea', flexShrink: 0 }}>🔒</span>
      )}

      {/* Options button — always visible so it's easy to click on narrow columns */}
      {showMenu && (
        <button
          ref={btnRef}
          onClick={openMenu}
          title="Column options"
          style={{
            flexShrink: 0, width: 22, height: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 4, border: 'none', cursor: 'pointer',
            fontSize: 13, color: menuOpen ? '#0073ea' : '#9699a6',
            background: menuOpen ? '#dce9ff' : 'transparent',
            transition: 'color 0.12s, background 0.12s',
          }}
          onMouseEnter={e => { if (!menuOpen) { e.currentTarget.style.color = '#323338'; e.currentTarget.style.background = '#e6e9ef'; } }}
          onMouseLeave={e => { if (!menuOpen) { e.currentTarget.style.color = '#9699a6'; e.currentTarget.style.background = 'transparent'; } }}
        >▾</button>
      )}

      {/* Dropdown — fixed positioning, never clips */}
      {menuOpen && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 9999,
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            border: '1px solid #e0e3e8',
            minWidth: 200,
            overflow: 'hidden',
          }}
        >
          {/* Header: column type + title */}
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>
              {col.type.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {col.title}
            </div>
          </div>

          {isManager && menuItem(startRename, '✏️ Rename')}
          {isManager && !['creation_log', 'person'].includes(col.type) && (
            <div>
              <div
                onClick={() => setShowTypePicker(v => !v)}
                style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <span>🔄 Change Type</span>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{showTypePicker ? '▲' : '▼'}</span>
              </div>
              {showTypePicker && (
                <div style={{ padding: '6px 10px 10px', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    Select new type
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                    {CHANGEABLE_TYPES.map(t => {
                      const isCurrent = col.type === t.value;
                      return (
                        <div
                          key={t.value}
                          onClick={() => {
                            if (isCurrent) return;
                            setMenuOpen(false);
                            setShowTypePicker(false);
                            onChangeType?.(col, t.value);
                          }}
                          title={t.label}
                          style={{
                            padding: '5px 4px', borderRadius: 6, textAlign: 'center',
                            cursor: isCurrent ? 'default' : 'pointer',
                            border: `1.5px solid ${isCurrent ? '#0073ea' : 'var(--border-color)'}`,
                            background: isCurrent ? '#e3f0ff' : 'var(--card-bg)',
                            opacity: isCurrent ? 1 : 0.9,
                          }}
                          onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--hover-bg)'; }}
                          onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--card-bg)'; }}
                        >
                          <div style={{ fontSize: 14 }}>{t.icon}</div>
                          <div style={{ fontSize: 9, marginTop: 2, color: isCurrent ? '#0073ea' : 'var(--text-secondary)', fontWeight: isCurrent ? 700 : 400, lineHeight: 1.2 }}>{t.label}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 7, lineHeight: 1.4 }}>
                    Existing cell values are kept as-is.
                  </div>
                </div>
              )}
            </div>
          )}
          {col.type === 'status' && menuItem(handleEditStatus, '🏷️ Edit Labels')}
          {col.type === 'dropdown' && isManager && menuItem(handleEditStatus, '⚙️ Edit Options')}
          {col.type === 'formula' && isManager && menuItem(() => { setMenuOpen(false); onEditFormula?.(col); }, '🧮 Edit Formula')}
          {col.type === 'person' && isManager && menuItem(
            handleToggleVisibility,
            col.settings?.isOwnerColumn ? '🔒 Visibility: ON' : '🔓 Visibility: OFF'
          )}
          {!NO_DEFAULT_TYPES.includes(col.type) && isManager && menuItem(
            handleSetDefault,
            <>⚡ Default Value{(col.settings?.defaultValue !== undefined && col.settings?.defaultValue !== null && String(col.settings.defaultValue) !== '') ? <span style={{ color: '#0073ea', marginLeft: 4 }}>✓</span> : null}</>
          )}

          <div style={{ borderTop: '1px solid #f0f1f4', margin: '4px 0' }} />
          {menuItem(() => { setMenuOpen(false); onSort(col.id, 'asc'); }, <><span style={{ fontSize: 12 }}>↑</span> Sort A → Z</>)}
          {menuItem(() => { setMenuOpen(false); onSort(col.id, 'desc'); }, <><span style={{ fontSize: 12 }}>↓</span> Sort Z → A</>)}
          {sortConfig?.colId === col.id && menuItem(() => { setMenuOpen(false); onSort(null); }, <><span style={{ fontSize: 12 }}>✕</span> Clear Sort</>)}

          {isManager && (
            <>
              <div style={{ height: 1, background: '#f0f0f0', margin: '3px 0' }} />
              {menuItem(handleDelete, '🗑️ Delete Column', true)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Column resize handle ──────────────────────────────────────────────────────
function ResizeHandle({ onMouseDown }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
        cursor: 'col-resize', zIndex: 5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 2, height: '60%', borderRadius: 2,
        background: hovered ? '#0073ea' : 'transparent',
        transition: 'background 0.15s',
      }} />
    </div>
  );
}

// ── Column width helper ───────────────────────────────────────────────────────
function colWidth(col) {
  switch (col.type) {
    case 'progress': case 'timeline': return 210;
    case 'long_text': return 180;
    case 'date': return 130;
    case 'status': return 140;
    case 'checkbox': return 80;
    case 'rating': return 120;
    case 'color_picker': return 110;
    case 'tags': return 160;
    default: return 140;
  }
}

// ── Item row ──────────────────────────────────────────────────────────────────
const ItemRow = React.memo(function ItemRow({ item, group, columns, onItemUpdate, onItemDelete, onItemCopy, onValueChange,
  onEditSettings, onDragStart, onDragEnd, onDragOver, onDrop, canEdit, isManager, onOpenDetail,
  isSelected, onToggleSelect, subitems, isExpanded, onToggleExpand }) {
  const [hovered, setHovered] = useState(false);
  const rowBg = isSelected ? 'rgba(0,115,234,0.1)' : hovered ? 'var(--hover-bg)' : 'var(--bg-primary)';
  return (
    <tr
      draggable
      onDragStart={e => onDragStart(e, item, group.id)}
      onDragEnd={onDragEnd}
      onDragOver={e => onDragOver(e, group.id, item.id)}
      onDrop={e => onDrop(e, group.id, item.id)}
      onClick={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); onToggleSelect?.(item.id); } }}
      style={{ borderBottom: '1px solid var(--border-color)', background: rowBg, height: 40, cursor: 'grab', transition: 'background 0.1s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Color stripe */}
      <td style={{ width: 6, padding: 0, background: group.color, position: 'sticky', left: 0, zIndex: 2 }} />
      {/* Drag handle / checkbox */}
      <td style={{ width: 36, padding: '0 8px', textAlign: 'center', borderRight: '1px solid var(--border-color)', background: rowBg, position: 'sticky', left: 6, zIndex: 2 }}>
        {hovered || isSelected
          ? <input
            type="checkbox"
            checked={!!isSelected}
            onChange={e => { e.stopPropagation(); onToggleSelect?.(item.id); }}
            onClick={e => e.stopPropagation()}
            style={{ cursor: 'pointer', accentColor: group.color }}
          />
          : <span style={{ color: '#c5c7d0', fontSize: 16, cursor: 'grab', userSelect: 'none', display: 'block', textAlign: 'center' }} title="Drag to reorder">⠿</span>
        }
      </td>
      {/* Item name */}
      <td style={{ padding: '4px 8px 4px 8px', borderRight: '1px solid var(--border-color)', background: rowBg, position: 'sticky', left: 42, zIndex: 2, boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Expand/collapse toggle for subitems */}
          <button
            onClick={e => { e.stopPropagation(); onToggleExpand?.(); }}
            title={isExpanded ? 'Collapse subitems' : 'Expand subitems'}
            style={{
              flexShrink: 0, width: 16, height: 16, padding: 0,
              color: (subitems?.length > 0 || isExpanded) ? '#676879' : (hovered ? '#c5c7d0' : 'transparent'),
              fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform 0.15s, color 0.15s',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              border: 'none', background: 'transparent', cursor: 'pointer',
            }}
          >▶</button>
          <button
            onClick={e => { e.stopPropagation(); onOpenDetail(item.id); }}
            title={item.comment_count > 0 ? `${item.comment_count} comment${item.comment_count !== 1 ? 's' : ''}` : 'Open updates'}
            style={{
              flexShrink: 0, position: 'relative',
              width: 22, height: 22, borderRadius: 4,
              background: hovered ? 'var(--hover-bg)' : 'transparent',
              color: item.comment_count > 0 ? '#0073ea' : (hovered ? '#676879' : 'transparent'),
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer', transition: 'color 0.15s, background 0.15s',
            }}
          >
            💬
            {item.comment_count > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: '#0073ea', color: '#fff',
                fontSize: 9, fontWeight: 700,
                borderRadius: 8, padding: '1px 4px',
                lineHeight: 1.4, minWidth: 14, textAlign: 'center',
              }}>
                {item.comment_count > 99 ? '99+' : item.comment_count}
              </span>
            )}
          </button>
          {canEdit
            ? <InlineEdit value={item.name} onSave={name => onItemUpdate(item.id, name)} singleClick
              style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }} />
            : <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', padding: '0 4px' }}>{item.name}</span>
          }
          {/* Subitem count badge */}
          {subitems?.length > 0 && !isExpanded && (
            <span
              onClick={e => { e.stopPropagation(); onToggleExpand?.(); }}
              title="Click to expand subitems"
              style={{
                fontSize: 10, color: '#0073ea', background: '#e8f0fe',
                borderRadius: 10, padding: '1px 6px', fontWeight: 600,
                flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >{subitems.length} {subitems.length === 1 ? 'subitem' : 'subitems'}</span>
          )}
        </div>
      </td>
      {/* Data columns */}
      {
        columns.map(col => (
          // <td key={col.id} style={{ padding: '3px 6px', borderRight: '1px solid #e6e9ef' }}>
          <td key={col.id} style={{
            padding: (col.type === 'status' || col.type === 'priority') ? 0 : '3px 6px',
            borderRight: '1px solid var(--border-color)',
            height: 34,
          }}>
            <ColumnCell
              column={col}
              value={item.values?.[col.id] || ''}
              onChange={(col.type === 'creation_log' || !canEdit || (col.type === 'person' && !isManager)) ? undefined : val => onValueChange(item.id, col.id, val, col.title)}
              onEditSettings={onEditSettings}
              item={item}
              columns={columns}
            />
          </td>
        ))
      }
      {/* Copy + Delete */}
      <td style={{ width: 64, textAlign: 'center', borderRight: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
        {canEdit && hovered && (
          <button
            onClick={e => { e.stopPropagation(); onItemCopy?.(item.id); }}
            style={{ color: '#c5c7d0', fontSize: 13, lineHeight: 1, marginRight: 6, transition: 'color 0.15s' }}
            title="Duplicate item"
            onMouseEnter={e => e.currentTarget.style.color = '#0073ea'}
            onMouseLeave={e => e.currentTarget.style.color = '#c5c7d0'}
          >⧉</button>
        )}
        {canEdit && (
          <button onClick={() => onItemDelete(item.id)}
            style={{ color: hovered ? '#e2445c' : '#c5c7d0', fontSize: 18, lineHeight: 1, transition: 'color 0.15s' }}
            title="Delete item">×</button>
        )}
      </td>
      <td />
    </tr >
  );
}, (prev, next) => {
  return (
    prev.item === next.item &&
    prev.isSelected === next.isSelected &&
    prev.isExpanded === next.isExpanded &&
    prev.columns === next.columns &&
    prev.canEdit === next.canEdit &&
    prev.subitems === next.subitems
  );
});

// ── Subitem row ────────────────────────────────────────────────────────────────
function SubitemRow({ subitem, group, columns, onUpdate, onDelete, onValueChange, canEdit, isManager, onOpenDetail }) {
  const [hovered, setHovered] = useState(false);
  const rowBg = hovered ? 'var(--hover-bg)' : 'var(--bg-secondary)';
  return (
    <tr
      style={{ borderBottom: '1px solid var(--border-color)', background: rowBg, height: 36, transition: 'background 0.1s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Color stripe (faded) */}
      <td style={{ width: 6, padding: 0, background: group.color, opacity: 0.3, position: 'sticky', left: 0, zIndex: 2 }} />
      {/* Indent marker */}
      <td style={{ width: 36, textAlign: 'center', borderRight: '1px solid var(--border-color)', background: rowBg, position: 'sticky', left: 6, zIndex: 2 }}>
        <span style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          border: '1.5px solid #c5c7d0', verticalAlign: 'middle',
        }} />
      </td>
      {/* Subitem name — indented */}
      <td style={{ padding: '4px 8px 4px 28px', background: rowBg, position: 'sticky', left: 42, zIndex: 2, boxShadow: '2px 0 5px -2px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {hovered && (
            <button
              onClick={e => { e.stopPropagation(); onOpenDetail(subitem.id); }}
              title="Open detail panel"
              style={{
                flexShrink: 0, width: 18, height: 18, borderRadius: 3,
                background: '#0073ea', color: '#fff', fontSize: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer',
              }}
            >⊡</button>
          )}
          {canEdit
            ? <InlineEdit value={subitem.name} onSave={name => onUpdate(subitem.id, name)} singleClick
              style={{ fontSize: 12, color: 'var(--text-primary)' }} />
            : <span style={{ fontSize: 12, color: 'var(--text-primary)', padding: '0 4px' }}>{subitem.name}</span>
          }
        </div>
      </td>
      {/* Data columns */}
      {columns.map(col => (
        //  <td key={col.id} style={{ padding: '3px 6px', borderRight: '1px solid #e6e9ef', background: rowBg }}>
        <td key={col.id} style={{
          padding: (col.type === 'status' || col.type === 'priority') ? 0 : '3px 6px',
          borderRight: '1px solid var(--border-color)',
          background: rowBg,
          height: 34,
        }}>
          <ColumnCell
            column={col}
            value={subitem.values?.[col.id] || ''}
            onChange={(col.type === 'creation_log' || !canEdit || (col.type === 'person' && !isManager))
              ? undefined
              : val => onValueChange(subitem.id, col.id, val)}
            onEditSettings={() => { }}
            item={subitem}
          />
        </td>
      ))}
      {/* Delete */}
      <td style={{ width: 36, textAlign: 'center', borderRight: '1px solid #e6e9ef', background: rowBg }}>
        {canEdit && hovered && (
          <button
            onClick={() => onDelete(subitem.id)}
            style={{ color: '#e2445c', fontSize: 18, lineHeight: 1 }}
            title="Delete subitem"
          >×</button>
        )}
      </td>
      <td style={{ background: rowBg }} />
    </tr>
  );
}

// ── Add-subitem row ────────────────────────────────────────────────────────────
function AddSubitemRow({ parentItemId, groupId, onAdd, colSpan }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const toast = useToast();

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      await onAdd(parentItemId, groupId, name.trim());
      setName('');
      setAdding(false);
    } catch { toast('Failed to add subitem', 'error'); }
  };

  return (
    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
      <td style={{ width: 6, padding: 0 }} />
      <td style={{ width: 36 }} />
      <td colSpan={colSpan} style={{ padding: '4px 12px 4px 28px' }}>
        {adding ? (
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setAdding(false); setName(''); }
            }}
            onBlur={() => { if (!name.trim()) setAdding(false); }}
            placeholder="Subitem name — press Enter to save"
            style={{ width: 260, border: '1.5px solid #0073ea', borderRadius: 5, padding: '4px 8px', outline: 'none', fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}
            onMouseEnter={e => e.currentTarget.style.color = '#0073ea'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          >+ Add Subitem</button>
        )}
      </td>
    </tr>
  );
}

// ── Thin drop-indicator row ───────────────────────────────────────────────────
function DropLine({ colSpan }) {
  return (
    <tr style={{ height: 3, pointerEvents: 'none' }}>
      <td colSpan={colSpan} style={{
        padding: 0, height: 3,
        background: 'linear-gradient(90deg,#0073ea,#40a9ff)',
        boxShadow: '0 0 6px #0073ea80',
      }} />
    </tr>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────
function BulkActionBar({ count, groups, onMove, onDelete, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div style={{
      position: 'sticky', bottom: 0, zIndex: 50,
      background: '#1f2d3d', color: '#fff',
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 14,
      boxShadow: '0 -3px 12px rgba(0,0,0,0.25)',
      borderTop: '2px solid #0073ea',
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, background: '#0073ea', borderRadius: 20, padding: '2px 10px' }}>
        {count} selected
      </span>
      <span style={{ fontSize: 13, color: '#c5c7d0' }}>
        {count === 1 ? '1 item' : `${count} items`}
      </span>

      {/* Move to group */}
      <div style={{ position: 'relative' }} ref={ref}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            background: open ? '#0073ea' : '#2d3f55', border: '1px solid #3d5166',
            color: '#fff', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#3d5166'; }}
          onMouseLeave={e => { if (!open) e.currentTarget.style.background = '#2d3f55'; }}
        >
          ↗ Move to group ▾
        </button>
        {open && (
          <div style={{
            position: 'absolute', bottom: '110%', left: 0,
            background: '#fff', borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
            border: '1px solid #e6e9ef', minWidth: 200, overflow: 'hidden', zIndex: 200,
          }}>
            {groups.map(g => (
              <div
                key={g.id}
                onClick={() => { setOpen(false); onMove(g.id); }}
                style={{
                  padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: '#323338',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f6ff'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                {g.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete selected */}
      <button
        onClick={onDelete}
        style={{
          background: 'transparent', border: '1px solid #3d5166', color: '#e2445c',
          borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(226,68,92,0.15)'; e.currentTarget.style.borderColor = '#e2445c'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#3d5166'; }}
      >
        🗑 Delete
      </button>

      <button
        onClick={onClear}
        style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #3d5166', color: '#c5c7d0', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#e2445c'; e.currentTarget.style.color = '#e2445c'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#3d5166'; e.currentTarget.style.color = '#c5c7d0'; }}
      >× Clear selection</button>
    </div>
  );
}

// ── Group rows (returns a fragment for tbody) ─────────────────────────────────
function GroupRows({ group, columns, isManager, canEdit, onGroupUpdate, onGroupDelete,
  onItemCreate, onItemUpdate, onItemDelete, onItemCopy, onValueChange,
  onEditSettings, dropTarget, onDragStart, onDragEnd, onDragOver, onDrop, onOpenDetail,
  isGroupDragSrc, isGroupDropOver,
  onGroupDragStart, onGroupDragEnd, onGroupDragOver, onGroupDrop,
  selectedItems, onToggleSelect,
  onSubitemCreate, onSubitemUpdate, onSubitemDelete, onSubitemValueChange }) {
  const [collapsed, setCollapsed] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [expandedItems, setExpandedItems] = useState(new Set());
  const toast = useToast();
  const groupCheckRef = useRef(null);

  const items = group.items || [];
  const selectedInGroup = items.filter(i => selectedItems?.has(i.id));
  const allSelected = items.length > 0 && selectedInGroup.length === items.length;
  const someSelected = selectedInGroup.length > 0 && !allSelected;

  // Set indeterminate state imperatively (not a React prop)
  useEffect(() => {
    if (groupCheckRef.current) groupCheckRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const handleSelectGroup = useCallback((e) => {
    e.stopPropagation();
    if (allSelected) {
      // deselect all in group
      items.forEach(i => { if (selectedItems?.has(i.id)) onToggleSelect?.(i.id); });
    } else {
      // select all in group
      items.forEach(i => { if (!selectedItems?.has(i.id)) onToggleSelect?.(i.id); });
    }
  }, [allSelected, items, selectedItems, onToggleSelect]);

  const toggleExpand = (itemId) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const spanAll = columns.length + 5;

  const handleAddItem = async () => {
    if (!newItemName.trim()) return;
    try {
      await onItemCreate(group.id, newItemName.trim());
      setNewItemName('');
      setAddingItem(false);
    } catch { toast('Failed to add item', 'error'); }
  };

  const isDropTarget = dropTarget?.groupId === group.id;

  return (
    <>
      {/* ── Group header row ── */}
      <tr
        draggable={isManager}
        onDragStart={isManager ? onGroupDragStart : undefined}
        onDragEnd={isManager ? onGroupDragEnd : undefined}
        onDragOver={onGroupDragOver}
        onDrop={onGroupDrop}
        style={{
          background: isGroupDropOver ? '#e8f0fe' : '#fff',
          borderTop: isGroupDropOver ? '3px solid #0073ea' : '6px solid #f5f6f8',
          opacity: isGroupDragSrc ? 0.45 : 1,
          transition: 'background 0.12s, border-top 0.1s, opacity 0.1s',
          cursor: isManager ? 'grab' : 'default',
        }}
      >
        {/* Color stripe — sticky, no colspan, works in all browsers */}
        <td style={{ width: 6, padding: 0, background: group.color, borderRadius: '3px 0 0 0', position: 'sticky', left: 0, zIndex: 4 }} />

        {/* Group content — sticky, NO colspan (colspan breaks sticky), overflow:visible so content extends right */}
        <td style={{
          padding: 0,
          position: 'sticky', left: 6, zIndex: 3,
          overflow: 'visible',
          background: isGroupDropOver ? '#e8f0fe' : 'var(--bg-primary, #fff)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px 7px 6px',
            borderBottom: '1px solid #e6e9ef',
            background: isGroupDropOver ? '#e8f0fe' : 'var(--bg-primary, #fff)',
            boxShadow: '2px 0 6px rgba(0,0,0,0.07)',
            whiteSpace: 'nowrap',
            minWidth: 'max-content',
          }}>
            {isManager && (
              <span
                title="Drag to reorder group"
                style={{ color: '#c5c7d0', fontSize: 16, cursor: 'grab', userSelect: 'none', flexShrink: 0, lineHeight: 1 }}
                onMouseDown={e => e.stopPropagation()}
              >⠿</span>
            )}
            {items.length > 0 && (
              <input
                ref={groupCheckRef}
                type="checkbox"
                checked={allSelected}
                onChange={handleSelectGroup}
                onClick={e => e.stopPropagation()}
                title={allSelected ? 'Deselect all in group' : 'Select all in group'}
                style={{ cursor: 'pointer', accentColor: group.color, flexShrink: 0, width: 14, height: 14 }}
              />
            )}
            <button
              onClick={() => setCollapsed(c => !c)}
              style={{ color: group.color, fontSize: 10, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            >▼</button>
            <InlineEdit
              value={group.name}
              onSave={name => onGroupUpdate(group.id, { name, color: group.color })}
              singleClick={isManager}
              style={{ fontWeight: 700, fontSize: 14, color: group.color }}
              placeholder="Group name"
            />
            <span style={{ background: `${group.color}22`, color: group.color, borderRadius: 12, padding: '1px 9px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {group.items?.length || 0}
            </span>
            {isManager && (
              <button
                onClick={() => onGroupDelete(group.id)}
                style={{ marginLeft: 8, color: '#c5c7d0', fontSize: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#e2445c'; e.currentTarget.style.borderColor = '#e2445c'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#c5c7d0'; e.currentTarget.style.borderColor = '#e6e9ef'; }}
              >Delete group</button>
            )}
          </div>
        </td>

        {/* Filler — absorbs the remaining columns; not sticky so it scrolls normally */}
        <td colSpan={spanAll - 2} style={{
          borderBottom: '1px solid #e6e9ef',
          background: isGroupDropOver ? '#e8f0fe' : 'var(--bg-primary, #fff)',
        }} />
      </tr>

      {/* ── Item rows with drop indicators ── */}
      {!collapsed && group.items?.map(item => (
        <React.Fragment key={item.id}>
          {/* Drop line BEFORE this item */}
          {isDropTarget && dropTarget.beforeItemId === item.id && <DropLine colSpan={spanAll} />}
          <ItemRow
            item={item}
            group={group}
            columns={columns}
            canEdit={canEdit}
            isManager={isManager}
            onItemUpdate={onItemUpdate}
            onItemDelete={onItemDelete}
            onItemCopy={onItemCopy}
            onValueChange={onValueChange}
            onEditSettings={onEditSettings}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onOpenDetail={onOpenDetail}
            isSelected={selectedItems?.has(item.id)}
            onToggleSelect={onToggleSelect}
            subitems={item.subitems || []}
            isExpanded={expandedItems.has(item.id)}
            onToggleExpand={() => toggleExpand(item.id)}
          />
          {/* Subitems — shown when expanded */}
          {expandedItems.has(item.id) && (
            <>
              {(item.subitems || []).map(sub => (
                <SubitemRow
                  key={sub.id}
                  subitem={sub}
                  group={group}
                  columns={columns}
                  canEdit={canEdit}
                  isManager={isManager}
                  onUpdate={(id, name) => onSubitemUpdate(id, item.id, name)}
                  onDelete={(id) => onSubitemDelete(id, item.id)}
                  onValueChange={(id, colId, val) => onSubitemValueChange(id, item.id, colId, val)}
                  onOpenDetail={onOpenDetail}
                />
              ))}
              {canEdit && (
                <AddSubitemRow
                  parentItemId={item.id}
                  groupId={group.id}
                  onAdd={onSubitemCreate}
                  colSpan={columns.length + 3}
                />
              )}
            </>
          )}
        </React.Fragment>
      ))}

      {/* ── Add Item row — also acts as "drop at end" zone ── */}
      {!collapsed && (
        <>
          {/* Drop line at end of group */}
          {isDropTarget && dropTarget.beforeItemId === null && <DropLine colSpan={spanAll} />}
          {canEdit && (
            <tr
              style={{ borderBottom: '2px solid var(--border-color)', background: 'var(--card-bg)' }}
              onDragOver={e => onDragOver(e, group.id, null)}
              onDrop={e => onDrop(e, group.id, null)}
            >
              <td style={{ width: 6, padding: 0, background: group.color, opacity: 0.3 }} />
              <td style={{ width: 36 }} />
              <td colSpan={columns.length + 3} style={{ padding: '5px 12px' }}>
                {addingItem ? (
                  <input
                    autoFocus value={newItemName}
                    onChange={e => setNewItemName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddItem();
                      if (e.key === 'Escape') { setAddingItem(false); setNewItemName(''); }
                    }}
                    onBlur={() => { if (!newItemName.trim()) setAddingItem(false); }}
                    placeholder="Item name — press Enter to save"
                    style={{ width: 320, border: '1.5px solid #0073ea', borderRadius: 6, padding: '5px 10px', outline: 'none', fontSize: 13 }}
                  />
                ) : (
                  <button
                    onClick={() => setAddingItem(true)}
                    style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, padding: '3px 0' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#0073ea'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                  >+ Add Item</button>
                )}
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function FilterBar({ cols, filters, onFiltersChange }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const nameFilter = filters.find(f => f.colId === '_name');
  const colFilters = filters.filter(f => f.colId !== '_name');

  const setNameFilter = (val) => {
    const rest = filters.filter(f => f.colId !== '_name');
    onFiltersChange(val ? [{ colId: '_name', value: val }, ...rest] : rest);
  };

  const addColFilter = (col) => {
    setPickerOpen(false);
    if (filters.find(f => f.colId === col.id)) return;
    onFiltersChange([...filters, { colId: col.id, value: '', colTitle: col.title, colType: col.type, options: col.settings?.options || [] }]);
  };

  const updateColFilter = (idx, value) => {
    const updated = colFilters.map((f, i) => i === idx ? { ...f, value } : f);
    onFiltersChange(nameFilter ? [nameFilter, ...updated] : updated);
  };

  const removeColFilter = (idx) => {
    const updated = colFilters.filter((_, i) => i !== idx);
    onFiltersChange(nameFilter ? [nameFilter, ...updated] : updated);
  };

  const filterableCols = cols.filter(c =>
    ['status', 'dropdown', 'person', 'text', 'number', 'email'].includes(c.type) &&
    !colFilters.find(f => f.colId === c.id)
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '7px 20px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
    }}>
      {/* Name search */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <input
          type="text" placeholder="🔍  Search items…"
          value={nameFilter?.value || ''}
          onChange={e => setNameFilter(e.target.value)}
          style={{ border: '1.5px solid #ddd', borderRadius: 20, padding: '5px 12px', fontSize: 12, outline: 'none', width: 180, background: nameFilter ? '#fff8e1' : '#fff' }}
          onFocus={e => e.target.style.borderColor = '#0073ea'}
          onBlur={e => e.target.style.borderColor = nameFilter ? '#fdab3d' : '#ddd'}
        />
      </div>

      {/* Column filters */}
      {colFilters.map((f, idx) => (
        <div key={f.colId} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#e8f0fe', borderRadius: 20, padding: '3px 4px 3px 10px', fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: '#0073ea', flexShrink: 0 }}>{f.colTitle}:</span>
          {['status', 'dropdown', 'person'].includes(f.colType) && f.options?.length ? (
            <select value={f.value} onChange={e => updateColFilter(idx, e.target.value)}
              style={{ border: 'none', background: 'transparent', fontSize: 12, color: '#323338', outline: 'none', cursor: 'pointer' }}>
              <option value="">Any</option>
              {f.options.map(o => (
                <option key={typeof o === 'string' ? o : o.label} value={typeof o === 'string' ? o : o.label}>
                  {typeof o === 'string' ? o : o.label}
                </option>
              ))}
            </select>
          ) : (
            <input value={f.value} onChange={e => updateColFilter(idx, e.target.value)}
              placeholder="contains…"
              style={{ border: 'none', background: 'transparent', fontSize: 12, outline: 'none', width: 90, color: '#323338' }}
            />
          )}
          <button onClick={() => removeColFilter(idx)} style={{ color: '#999', fontSize: 14, padding: '0 4px', lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
            onMouseLeave={e => e.currentTarget.style.color = '#999'}>×</button>
        </div>
      ))}

      {/* Add filter */}
      {filterableCols.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button onClick={() => setPickerOpen(o => !o)}
            style={{ fontSize: 12, color: '#676879', border: '1.5px dashed #ddd', borderRadius: 20, padding: '4px 12px', background: '#fff' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#0073ea'; e.currentTarget.style.borderColor = '#0073ea'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#676879'; e.currentTarget.style.borderColor = '#ddd'; }}>
            + Add Filter
          </button>
          {pickerOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.13)', border: '1px solid #e6e9ef', zIndex: 100, minWidth: 160, overflow: 'hidden' }}>
              {filterableCols.map(col => (
                <div key={col.id} onClick={() => addColFilter(col)}
                  style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#323338' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f6ff'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  {col.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clear all */}
      {filters.length > 0 && (
        <button onClick={() => onFiltersChange([])}
          style={{ fontSize: 12, color: '#e2445c', marginLeft: 4, fontWeight: 600 }}>
          Clear all
        </button>
      )}

      {/* Active count badge */}
      {filters.length > 0 && (
        <span style={{ fontSize: 11, background: '#0073ea', color: '#fff', borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>
          {filters.length} active
        </span>
      )}
    </div>
  );
}

// ── Visibility badge ──────────────────────────────────────────────────────────
function VisibilityBadge({ visibility, onChange, isManager }) {
  const isPrivate = visibility === 'private';
  return (
    <button
      onClick={() => isManager && onChange(isPrivate ? 'org_wide' : 'private')}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
        border: `1.5px solid ${isPrivate ? '#a25ddc' : '#00c875'}`,
        color: isPrivate ? '#a25ddc' : '#037f4c',
        background: isPrivate ? 'rgba(162,93,220,0.15)' : 'rgba(0,200,117,0.15)',
        cursor: isManager ? 'pointer' : 'default',
      }}
      title={isManager ? `Click to make ${isPrivate ? 'Org-wide' : 'Private'}` : undefined}
    >
      {isPrivate ? '🔒 Private' : '🌐 Org-wide'}
    </button>
  );
}

// ── Mobile Card View (renders one group as cards) ─────────────────────────────
function MobileCardView({ group, columns, canEdit, isManager, onItemCreate, onItemUpdate,
  onItemDelete, onValueChange, onEditSettings, onOpenDetail }) {
  const [collapsed, setCollapsed] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const toast = useToast();

  const handleAddItem = async () => {
    if (!newItemName.trim()) return;
    try {
      await onItemCreate(group.id, newItemName.trim());
      setNewItemName('');
      setAddingItem(false);
    } catch { toast('Failed to add item', 'error'); }
  };

  return (
    <div style={{ padding: '0 12px 4px' }}>
      {/* Group header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', marginBottom: 8,
          background: 'var(--bg-secondary)', borderRadius: 8,
          cursor: 'pointer', minHeight: 44,
          borderLeft: `4px solid ${group.color}`,
        }}
      >
        <span style={{
          fontSize: 10, color: group.color, flexShrink: 0,
          display: 'inline-block', transition: 'transform 0.15s',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        }}>▼</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: group.color, flex: 1 }}>
          {group.name}
        </span>
        <span style={{
          background: `${group.color}22`, color: group.color,
          borderRadius: 12, padding: '1px 9px', fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {group.items?.length || 0}
        </span>
      </div>

      {/* Item cards */}
      {!collapsed && group.items?.map(item => (
        <div
          key={item.id}
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderLeft: `3px solid ${group.color}`,
            borderRadius: 8, padding: '12px 14px', marginBottom: 8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          {/* Name row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input
              type="checkbox"
              style={{ accentColor: group.color, flexShrink: 0, width: 16, height: 16 }}
              onClick={e => e.stopPropagation()}
            />
            {canEdit
              ? <InlineEdit
                value={item.name}
                onSave={name => onItemUpdate(item.id, name)}
                singleClick
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}
              />
              : <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{item.name}</span>
            }
            <button
              onClick={() => onOpenDetail(item.id)}
              style={{
                color: '#0073ea', fontSize: 11, padding: '4px 10px',
                border: '1.5px solid #0073ea', borderRadius: 6,
                fontWeight: 600, flexShrink: 0, background: 'transparent',
                minHeight: 32,
              }}
            >View</button>
          </div>

          {/* Column values */}
          {columns.map(col => (
            <div key={col.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0', borderTop: '1px solid var(--border-color)',
            }}>
              <span style={{
                fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.3px',
                minWidth: 76, flexShrink: 0,
              }}>
                {col.title}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ColumnCell
                  column={col}
                  value={item.values?.[col.id] || ''}
                  onChange={
                    (col.type === 'creation_log' || !canEdit || (col.type === 'person' && !isManager))
                      ? undefined
                      : val => onValueChange(item.id, col.id, val, col.title)
                  }
                  onEditSettings={onEditSettings}
                  item={item}
                />
              </div>
            </div>
          ))}

          {/* Delete */}
          {canEdit && (
            <button
              onClick={() => onItemDelete(item.id)}
              style={{ marginTop: 10, color: '#e2445c', fontSize: 12, padding: '4px 0', fontWeight: 500 }}
            >Delete item</button>
          )}
        </div>
      ))}

      {/* Add item */}
      {!collapsed && canEdit && (
        <div style={{ padding: '4px 0 8px' }}>
          {addingItem ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddItem();
                  if (e.key === 'Escape') { setAddingItem(false); setNewItemName(''); }
                }}
                placeholder="Item name…"
                style={{
                  flex: 1, border: '1.5px solid #0073ea', borderRadius: 6,
                  padding: '10px 12px', fontSize: 16, outline: 'none',
                  background: 'var(--input-bg)', color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={handleAddItem}
                style={{ padding: '10px 16px', background: '#0073ea', color: '#fff', borderRadius: 6, fontWeight: 600, fontSize: 13, minHeight: 44 }}
              >Add</button>
              <button
                onClick={() => { setAddingItem(false); setNewItemName(''); }}
                style={{ padding: '10px 12px', border: '1.5px solid var(--border-color)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 13, minHeight: 44 }}
              >✕</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingItem(true)}
              style={{
                color: '#676879', fontSize: 13, fontWeight: 600,
                padding: '10px 0', width: '100%', textAlign: 'left',
                minHeight: 44, display: 'flex', alignItems: 'center',
              }}
            >+ Add Item</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── More bottom sheet (mobile toolbar) ────────────────────────────────────────
function MoreBottomSheet({ isManager, canEdit, activeAutoCount, trashCount, importing,
  onClose, onAutomations, onForms, onFilter, filtersActive,
  onExport, onImport, onMembers, onActivity, onTrash,
  boardMembersCount }) {
  const options = [];
  if (isManager) {
    options.push({ icon: '⚡', label: `Automations${activeAutoCount > 0 ? ` (${activeAutoCount} active)` : ''}`, action: onAutomations });
    options.push({ icon: '📋', label: 'Forms', action: onForms });
  }
  options.push({ icon: '🔽', label: `Filter${filtersActive ? ' (active)' : ''}`, action: onFilter });
  options.push({ icon: '⬇️', label: 'Export', action: onExport });
  if (canEdit) {
    options.push({ icon: '⬆️', label: importing ? 'Importing…' : 'Import CSV', action: onImport, disabled: importing });
  }
  options.push({ icon: '👥', label: `Members (${boardMembersCount})`, action: onMembers });
  options.push({ icon: '📋', label: 'Activity Log', action: onActivity });
  options.push({ icon: '🗑️', label: `Trash${trashCount > 0 ? ` (${trashCount})` : ''}`, action: onTrash, danger: trashCount > 0 });

  const handleOption = (action, disabled) => {
    if (disabled) return;
    onClose();
    action();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-primary)', width: '100%',
          maxHeight: '70vh', borderRadius: '16px 16px 0 0',
          overflowY: 'auto',
        }}
      >
        {/* Handle bar */}
        <div style={{
          width: 32, height: 4, background: 'var(--border-color)',
          borderRadius: 2, margin: '12px auto 4px',
        }} />
        <div style={{ padding: '4px 0 16px' }}>
          {options.map((opt, i) => (
            <div
              key={i}
              onClick={() => handleOption(opt.action, opt.disabled)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '0 20px', fontSize: 15, fontWeight: 500, minHeight: 56,
                color: opt.danger ? '#e2445c' : opt.disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                borderBottom: i < options.length - 1 ? '1px solid var(--border-color)' : 'none',
                cursor: opt.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{opt.icon}</span>
              {opt.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Avatar helpers (used by AdvancedFilterBar) ────────────────────────────────
const _AVATAR_COLORS = [
  '#0073ea', '#00c875', '#fdab3d', '#e2445c',
  '#a25ddc', '#037f4c', '#ff642e', '#784bd1',
  '#ff5ac4', '#0099cc', '#bb3354', '#666666',
];
function nameToColor(name) {
  const n = name || '';
  const sum = n.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return _AVATAR_COLORS[sum % _AVATAR_COLORS.length];
}
function nameToInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Hover row helper for AdvancedFilterBar ────────────────────────────────────
function FilterHoverRow({ selected, onClick, children }) {
  const [h, setH] = useState(false);
  const base = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13 };
  return (
    <div
      style={{ ...base, background: selected ? '#f0f6ff' : h ? '#f7f8f9' : 'transparent', fontWeight: selected ? 600 : 400 }}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
    >{children}</div>
  );
}

// ── Advanced filter bar constants ─────────────────────────────────────────────
const FILTER_PRIORITY_OPTIONS = [
  { label: 'Critical', color: '#e2445c' },
  { label: 'High', color: '#ff642e' },
  { label: 'Medium', color: '#fdab3d' },
  { label: 'Low', color: '#00c875' },
];
const FILTER_DUE_DATE_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due Today' },
  { value: 'week', label: 'Due This Week' },
  { value: 'next_week', label: 'Due Next Week' },
  { value: 'none', label: 'No Due Date' },
  { value: 'has_date', label: 'Has Due Date' },
];
const FILTER_DEFAULT_STATUS = [
  { label: 'Not Started', color: '#c4c4c4' },
  { label: 'In Progress', color: '#fdab3d' },
  { label: 'Done', color: '#00c875' },
  { label: 'Stuck', color: '#e2445c' },
];

function AdvancedFilterBar({ activeFilters, setActiveFilters, allGroups, cols }) {
  const [openDropdown, setOpenDropdown] = useState(null);
  const [personSearch, setPersonSearch] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdown]);

  // Collect options from board columns
  const personOptions = [...new Set(
    cols.filter(c => c.type === 'person').flatMap(c => c.settings?.options || [])
  )];
  const statusMap = {};
  cols.filter(c => c.type === 'status').forEach(c => {
    (c.settings?.options || FILTER_DEFAULT_STATUS).forEach(o => {
      if (!statusMap[o.label]) statusMap[o.label] = o.color;
    });
  });
  const statusOptions = Object.entries(statusMap).map(([label, color]) => ({ label, color }));
  const filteredPersons = personOptions.filter(p =>
    !personSearch || p.toLowerCase().includes(personSearch.toLowerCase())
  );

  const totalActive = activeFilters.persons.length + activeFilters.groups.length +
    activeFilters.statuses.length + activeFilters.priorities.length + (activeFilters.dueDate ? 1 : 0);

  const toggle = (key, val) => setActiveFilters(prev => {
    const arr = prev[key];
    return { ...prev, [key]: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val] };
  });

  const selectAll = (key, options) => setActiveFilters(prev => ({
    ...prev, [key]: prev[key].length === options.length ? [] : [...options],
  }));

  const filterBtn = (label, isActive) => ({
    border: `1px solid ${isActive ? '#0073ea' : 'var(--border-color)'}`,
    borderRadius: 20, padding: '5px 12px', fontSize: 13,
    background: isActive ? '#e8f0fe' : 'var(--bg-primary)',
    color: isActive ? '#0073ea' : 'var(--text-primary)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
  });

  const dropdownBase = {
    position: 'absolute', top: 'calc(100% + 6px)', left: 0,
    background: 'var(--card-bg)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    zIndex: 100, minWidth: 200, maxHeight: 280, overflowY: 'auto',
    border: '1px solid var(--border-color)',
  };


  const Checkbox = ({ checked }) => (
    <span style={{
      width: 16, height: 16, borderRadius: 3, border: '2px solid #0073ea',
      background: checked ? '#0073ea' : '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {checked && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
    </span>
  );

  const Radio = ({ checked }) => (
    <span style={{
      width: 16, height: 16, borderRadius: '50%', border: '2px solid #0073ea',
      background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {checked && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0073ea' }} />}
    </span>
  );

  return (
    <div
      ref={containerRef}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 6, padding: '10px 16px', margin: '0 16px 6px',
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--primary-blue)', fontWeight: 600, flexShrink: 0 }}>
        🔍 Filters:
      </span>

      {/* ── Person ── */}
      <div style={{ position: 'relative' }}>
        <button
          style={filterBtn('person', activeFilters.persons.length > 0)}
          onClick={() => { setOpenDropdown(openDropdown === 'person' ? null : 'person'); setPersonSearch(''); }}
        >
          Person{activeFilters.persons.length > 0 ? ` (${activeFilters.persons.length})` : ''} ▾
        </button>
        {openDropdown === 'person' && (
          <div style={dropdownBase} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #f0f1f4' }}>
              <input autoFocus placeholder="Search people…" value={personSearch}
                onChange={e => setPersonSearch(e.target.value)}
                style={{ width: '100%', border: '1px solid #ddd', borderRadius: 6, padding: '5px 8px', fontSize: 12, outline: 'none' }}
              />
            </div>
            {filteredPersons.length > 0 && (
              <FilterHoverRow selected={activeFilters.persons.length === filteredPersons.length && filteredPersons.length > 0}
                onClick={() => selectAll('persons', filteredPersons)}>
                <Checkbox checked={activeFilters.persons.length === filteredPersons.length && filteredPersons.length > 0} />
                <span>Select All</span>
              </FilterHoverRow>
            )}
            {filteredPersons.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 12, color: '#aaa', textAlign: 'center' }}>No people found</div>
            )}
            {filteredPersons.map(name => (
              <FilterHoverRow key={name} selected={activeFilters.persons.includes(name)} onClick={() => toggle('persons', name)}>
                <Checkbox checked={activeFilters.persons.includes(name)} />
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: nameToColor(name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                  {nameToInitials(name)}
                </div>
                {name}
              </FilterHoverRow>
            ))}
          </div>
        )}
      </div>

      {/* ── Group ── */}
      <div style={{ position: 'relative' }}>
        <button
          style={filterBtn('group', activeFilters.groups.length > 0)}
          onClick={() => setOpenDropdown(openDropdown === 'group' ? null : 'group')}
        >
          Group{activeFilters.groups.length > 0 ? ` (${activeFilters.groups.length})` : ''} ▾
        </button>
        {openDropdown === 'group' && (
          <div style={dropdownBase} onClick={e => e.stopPropagation()}>
            <FilterHoverRow selected={activeFilters.groups.length === allGroups.length && allGroups.length > 0}
              onClick={() => selectAll('groups', allGroups.map(g => g.id))}>
              <Checkbox checked={activeFilters.groups.length === allGroups.length && allGroups.length > 0} />
              <span>Select All</span>
            </FilterHoverRow>
            {allGroups.map(g => (
              <FilterHoverRow key={g.id} selected={activeFilters.groups.includes(g.id)} onClick={() => toggle('groups', g.id)}>
                <Checkbox checked={activeFilters.groups.includes(g.id)} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                {g.name}
              </FilterHoverRow>
            ))}
          </div>
        )}
      </div>

      {/* ── Status ── */}
      <div style={{ position: 'relative' }}>
        <button
          style={filterBtn('status', activeFilters.statuses.length > 0)}
          onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
        >
          Status{activeFilters.statuses.length > 0 ? ` (${activeFilters.statuses.length})` : ''} ▾
        </button>
        {openDropdown === 'status' && (
          <div style={dropdownBase} onClick={e => e.stopPropagation()}>
            <FilterHoverRow selected={statusOptions.length > 0 && activeFilters.statuses.length === statusOptions.length}
              onClick={() => selectAll('statuses', statusOptions.map(o => o.label))}>
              <Checkbox checked={statusOptions.length > 0 && activeFilters.statuses.length === statusOptions.length} />
              <span>Select All</span>
            </FilterHoverRow>
            {statusOptions.map(opt => (
              <FilterHoverRow key={opt.label} selected={activeFilters.statuses.includes(opt.label)} onClick={() => toggle('statuses', opt.label)}>
                <Checkbox checked={activeFilters.statuses.includes(opt.label)} />
                <span style={{ background: opt.color, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{opt.label}</span>
              </FilterHoverRow>
            ))}
          </div>
        )}
      </div>

      {/* ── Priority ── */}
      <div style={{ position: 'relative' }}>
        <button
          style={filterBtn('priority', activeFilters.priorities.length > 0)}
          onClick={() => setOpenDropdown(openDropdown === 'priority' ? null : 'priority')}
        >
          Priority{activeFilters.priorities.length > 0 ? ` (${activeFilters.priorities.length})` : ''} ▾
        </button>
        {openDropdown === 'priority' && (
          <div style={dropdownBase} onClick={e => e.stopPropagation()}>
            <FilterHoverRow selected={activeFilters.priorities.length === FILTER_PRIORITY_OPTIONS.length}
              onClick={() => selectAll('priorities', FILTER_PRIORITY_OPTIONS.map(o => o.label))}>
              <Checkbox checked={activeFilters.priorities.length === FILTER_PRIORITY_OPTIONS.length} />
              <span>Select All</span>
            </FilterHoverRow>
            {FILTER_PRIORITY_OPTIONS.map(opt => (
              <FilterHoverRow key={opt.label} selected={activeFilters.priorities.includes(opt.label)} onClick={() => toggle('priorities', opt.label)}>
                <Checkbox checked={activeFilters.priorities.includes(opt.label)} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                {opt.label}
              </FilterHoverRow>
            ))}
          </div>
        )}
      </div>

      {/* ── Due Date ── */}
      <div style={{ position: 'relative' }}>
        <button
          style={filterBtn('dueDate', !!activeFilters.dueDate)}
          onClick={() => setOpenDropdown(openDropdown === 'dueDate' ? null : 'dueDate')}
        >
          Due Date{activeFilters.dueDate ? ' ✓' : ''} ▾
        </button>
        {openDropdown === 'dueDate' && (
          <div style={dropdownBase} onClick={e => e.stopPropagation()}>
            {FILTER_DUE_DATE_OPTIONS.map(opt => (
              <FilterHoverRow key={opt.value} selected={activeFilters.dueDate === opt.value}
                onClick={() => { setActiveFilters(prev => ({ ...prev, dueDate: activeFilters.dueDate === opt.value ? null : opt.value })); setOpenDropdown(null); }}>
                <Radio checked={activeFilters.dueDate === opt.value} />
                {opt.label}
              </FilterHoverRow>
            ))}
          </div>
        )}
      </div>

      {/* ── Clear All ── */}
      {totalActive > 0 && (
        <button
          onClick={() => setActiveFilters({ persons: [], groups: [], statuses: [], priorities: [], dueDate: null })}
          style={{ fontSize: 12, color: '#e2445c', fontWeight: 600, border: '1px solid #f5c0ca', borderRadius: 20, padding: '5px 12px', background: '#fff', cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.background = '#fff5f7'}
          onMouseLeave={e => e.currentTarget.style.background = '#fff'}
        >× Clear All</button>
      )}
    </div>
  );
}

// ── View Tab Bar ──────────────────────────────────────────────────────────────
function ViewTabBar({ views, activeViewId, mainViewId, unsavedChanges, onSwitch, onRename, onDelete, onCreate, isManager }) {
  const [menuViewId, setMenuViewId] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuViewId) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuViewId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuViewId]);

  const openMenu = (e, viewId) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
    setMenuViewId(v => v === viewId ? null : viewId);
  };

  return (
    <div style={{
      height: 38, background: 'var(--bg-primary, #fff)',
      borderBottom: '1px solid var(--border-color, #e6e9ef)',
      display: 'flex', alignItems: 'center', padding: '0 16px',
      flexShrink: 0, gap: 0, overflowX: 'auto',
    }}>
      {views.map(view => {
        const isActive = view.id === activeViewId;
        const isMain = view.id === mainViewId;
        const showDot = isActive && unsavedChanges;
        return (
          <div
            key={view.id}
            style={{
              display: 'flex', alignItems: 'center', height: '100%', gap: 4,
              borderBottom: isActive ? '2px solid #0073ea' : '2px solid transparent',
              padding: '0 4px 0 12px',
              fontSize: 13, fontWeight: 500,
              color: isActive ? '#0073ea' : '#676879',
              cursor: 'pointer', userSelect: 'none', flexShrink: 0,
              transition: 'color 0.12s',
            }}
            onClick={() => !isActive && onSwitch(view)}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--hover-bg, #f5f6f8)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = ''; }}
          >
            <span style={{ fontSize: 13 }}>⊞</span>
            <InlineEdit
              value={view.name}
              onSave={name => onRename(view.id, name)}
              style={{ fontSize: 13, fontWeight: 500, color: isActive ? '#0073ea' : '#676879', maxWidth: 140 }}
            />
            {isMain && (
              <span title="Main Table — filters & hidden columns/groups cannot be applied here" style={{ fontSize: 11, color: isActive ? '#0073ea' : '#9699a6', flexShrink: 0 }}>🔒</span>
            )}
            {showDot && (
              <span title="Unsaved changes" style={{ width: 7, height: 7, borderRadius: '50%', background: '#fdab3d', flexShrink: 0 }} />
            )}
            {isManager && !isMain && (
              <button
                onClick={e => openMenu(e, view.id)}
                style={{
                  width: 20, height: 20, borderRadius: 4, border: 'none',
                  background: 'transparent', color: '#c5c7d0', fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0, lineHeight: 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#e6e9ef'; e.currentTarget.style.color = '#676879'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#c5c7d0'; }}
              >…</button>
            )}
          </div>
        );
      })}

      {/* + Add View */}
      {isManager && (
        <button
          onClick={onCreate}
          style={{
            marginLeft: 6, padding: '4px 12px', fontSize: 12, fontWeight: 500,
            color: '#676879', border: '1px dashed #c5c7d0',
            borderRadius: 6, background: 'transparent', cursor: 'pointer', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#0073ea'; e.currentTarget.style.borderColor = '#0073ea'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#676879'; e.currentTarget.style.borderColor = '#c5c7d0'; }}
        >+ Add View</button>
      )}

      {/* Context menu */}
      {menuViewId && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: menuPos.top, left: menuPos.left,
            background: '#fff', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            border: '1px solid #e6e9ef', zIndex: 10000, minWidth: 160, overflow: 'hidden',
          }}
        >
          <div
            onClick={() => {
              const isLast = views.length <= 1;
              if (isLast) return;
              onDelete(menuViewId);
              setMenuViewId(null);
            }}
            style={{
              padding: '9px 14px', fontSize: 13, cursor: views.length <= 1 ? 'not-allowed' : 'pointer',
              color: views.length <= 1 ? '#c5c7d0' : '#e2445c',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={e => { if (views.length > 1) e.currentTarget.style.background = '#fff5f7'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
          >
            🗑 Delete view
            {views.length <= 1 && <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>last view</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Condition options by column type ──────────────────────────────────────────
function conditionsFor(colType) {
  switch (colType) {
    case 'status':
    case 'priority':
    case 'dropdown':
      return [
        { value: 'is', label: 'is' },
        { value: 'is_not', label: 'is not' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
      ];
    case 'person':
      return [
        { value: 'is', label: 'is' },
        { value: 'is_not', label: 'is not' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
      ];
    case 'date':
      return [
        { value: 'overdue', label: 'overdue' },
        { value: 'today', label: 'due today' },
        { value: 'this_week', label: 'due this week' },
        { value: 'next_week', label: 'due next week' },
        { value: 'before', label: 'before' },
        { value: 'after', label: 'after' },
        { value: 'is', label: 'is (exact)' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
      ];
    default: // text, email, number, etc.
      return [
        { value: 'contains', label: 'contains' },
        { value: 'not_contains', label: 'does not contain' },
        { value: 'is', label: 'is (exact)' },
        { value: 'is_not', label: 'is not' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
      ];
  }
}

const NO_VALUE_CONDITIONS = new Set([
  'is_empty', 'is_not_empty', 'overdue', 'today', 'this_week', 'next_week',
]);

// ── Single filter row ─────────────────────────────────────────────────────────
function FilterRow({ rule, cols, boardMembers, onChange, onRemove, isFirst }) {
  const [valueDropOpen, setValueDropOpen] = useState(false);
  const valueDropRef = useRef(null);

  // Close value dropdown on outside click
  useEffect(() => {
    if (!valueDropOpen) return;
    const handler = (e) => {
      if (valueDropRef.current && !valueDropRef.current.contains(e.target)) {
        setValueDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [valueDropOpen]);

  const colOptions = [
    { id: 'name', title: 'Item Name', type: 'text' },
    ...cols,
  ];

  const selectedCol = colOptions.find(c => String(c.id) === String(rule.column_id)) || null;
  const colType = selectedCol?.type || 'text';
  const conditions = conditionsFor(colType);
  const needsValue = rule.condition && !NO_VALUE_CONDITIONS.has(rule.condition);

  // Close value dropdown when column or condition changes
  const prevColumnId = useRef(rule.column_id);
  const prevCondition = useRef(rule.condition);
  useEffect(() => {
    if (rule.column_id !== prevColumnId.current || rule.condition !== prevCondition.current) {
      setValueDropOpen(false);
      prevColumnId.current = rule.column_id;
      prevCondition.current = rule.condition;
    }
  }, [rule.column_id, rule.condition]);

  const getValueOptions = () => {
    if (!selectedCol) return [];
    if (colType === 'status' || colType === 'dropdown') {
      const opts = selectedCol.settings?.options || [];
      return opts.map(o => (typeof o === 'string' ? o : o.label));
    }
    if (colType === 'priority') return ['Critical', 'High', 'Medium', 'Low'];
    if (colType === 'person') {
      const opts = selectedCol.settings?.options || [];
      return opts.length ? opts : boardMembers.map(m => m.name);
    }
    return [];
  };

  const valueOptions = getValueOptions();
  const isMulti = ['status', 'priority', 'dropdown', 'person'].includes(colType);

  const toggleMultiValue = (opt) => {
    const current = Array.isArray(rule.value) ? rule.value : (rule.value ? [rule.value] : []);
    const next = current.includes(opt) ? current.filter(v => v !== opt) : [...current, opt];
    onChange({ ...rule, value: next });
  };

  const multiValues = Array.isArray(rule.value) ? rule.value : (rule.value ? [rule.value] : []);

  const inputStyle = {
    border: '1px solid #e6e9ef', borderRadius: 6, padding: '4px 8px',
    fontSize: 12, outline: 'none', background: 'var(--input-bg, #fff)',
    color: 'var(--text-primary, #323338)', minWidth: 80,
  };
  const selectStyle = { ...inputStyle, cursor: 'pointer', paddingRight: 4 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {/* Where / And label */}
      <span style={{ fontSize: 12, color: '#676879', width: 38, textAlign: 'right', flexShrink: 0 }}>
        {isFirst ? 'Where' : 'And'}
      </span>

      {/* Column dropdown */}
      <select
        value={rule.column_id || ''}
        onChange={e => {
          const col = colOptions.find(c => String(c.id) === e.target.value);
          onChange({ ...rule, column_id: e.target.value, column_name: col?.title || '', column_type: col?.type || 'text', condition: '', value: '' });
        }}
        style={{ ...selectStyle, borderColor: !rule.column_id ? '#e2445c' : '#e6e9ef' }}
      >
        <option value="">Select column…</option>
        {colOptions.map(c => (
          <option key={c.id} value={String(c.id)}>{c.title}</option>
        ))}
      </select>

      {/* Condition dropdown */}
      {rule.column_id && (
        <select
          value={rule.condition || ''}
          onChange={e => onChange({ ...rule, condition: e.target.value, value: '' })}
          style={{ ...selectStyle, borderColor: !rule.condition ? '#e2445c' : '#e6e9ef' }}
        >
          <option value="">Select condition…</option>
          {conditions.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      )}

      {/* Value input */}
      {rule.column_id && rule.condition && needsValue && (
        isMulti && valueOptions.length > 0 ? (
          /* Multi-select with toggle dropdown */
          <div ref={valueDropRef} style={{ position: 'relative' }}>
            <div
              onClick={() => setValueDropOpen(o => !o)}
              style={{
                ...inputStyle, display: 'flex', alignItems: 'center', gap: 4,
                cursor: 'pointer', minWidth: 130, flexWrap: 'wrap', maxWidth: 240,
                borderColor: valueDropOpen ? '#0073ea' : '#e6e9ef',
                userSelect: 'none',
              }}
            >
              {multiValues.length === 0 ? (
                <span style={{ color: '#aaa', fontSize: 12, flex: 1 }}>Any…</span>
              ) : multiValues.map(v => (
                <span key={v} style={{
                  background: '#e8f0fe', color: '#0073ea', borderRadius: 10,
                  padding: '1px 7px', fontSize: 11, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 3,
                }}>
                  {v}
                  <span
                    style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                    onClick={e => { e.stopPropagation(); toggleMultiValue(v); }}
                  >×</span>
                </span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#676879', flexShrink: 0 }}>
                {valueDropOpen ? '▲' : '▼'}
              </span>
            </div>

            {valueDropOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                background: 'var(--bg-primary, #fff)', border: '1px solid #e6e9ef',
                borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                zIndex: 500, minWidth: 160, maxHeight: 220, overflowY: 'auto',
              }}>
                {valueOptions.map(opt => (
                  <div
                    key={opt}
                    onMouseDown={e => { e.preventDefault(); toggleMultiValue(opt); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                      background: multiValues.includes(opt) ? '#f0f6ff' : 'transparent',
                      fontWeight: multiValues.includes(opt) ? 600 : 400,
                    }}
                    onMouseEnter={e => { if (!multiValues.includes(opt)) e.currentTarget.style.background = '#f7f8f9'; }}
                    onMouseLeave={e => { if (!multiValues.includes(opt)) e.currentTarget.style.background = multiValues.includes(opt) ? '#f0f6ff' : 'transparent'; }}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: 3, border: '2px solid #0073ea', flexShrink: 0,
                      background: multiValues.includes(opt) ? '#0073ea' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {multiValues.includes(opt) && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                    </span>
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : colType === 'date' ? (
          <input
            type="date"
            value={typeof rule.value === 'string' ? rule.value : ''}
            onChange={e => onChange({ ...rule, value: e.target.value })}
            style={inputStyle}
          />
        ) : (
          <input
            type="text"
            placeholder="Value…"
            value={typeof rule.value === 'string' ? rule.value : ''}
            onChange={e => onChange({ ...rule, value: e.target.value })}
            style={{ ...inputStyle, minWidth: 120 }}
          />
        )
      )}

      {/* Delete row button */}
      <button
        onClick={onRemove}
        title="Remove filter"
        style={{
          width: 24, height: 24, borderRadius: 4, border: 'none',
          background: 'transparent', color: '#c5c7d0', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', lineHeight: 1, flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#e2445c'; e.currentTarget.style.background = '#fff5f7'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#c5c7d0'; e.currentTarget.style.background = 'transparent'; }}
      >×</button>
    </div>
  );
}

// ── View Filter Panel ─────────────────────────────────────────────────────────
function ViewFilterPanel({ cols, board, activeFilters, setActiveFilters, hiddenColumns, setHiddenColumns, hiddenGroups, setHiddenGroups, onSave, unsavedChanges, totalItems, filteredItems }) {
  const [colSectionOpen, setColSectionOpen] = useState(false);
  const [grpSectionOpen, setGrpSectionOpen] = useState(false);

  const addRule = () => {
    const newRule = { id: `f_${Date.now()}`, column_id: '', column_name: '', column_type: 'text', condition: '', value: '' };
    setActiveFilters([...activeFilters, newRule]);
  };

  const updateRule = (idx, updated) => {
    setActiveFilters(activeFilters.map((r, i) => i === idx ? updated : r));
  };

  const removeRule = (idx) => {
    setActiveFilters(activeFilters.filter((_, i) => i !== idx));
  };

  const clearAll = () => {
    setActiveFilters([]);
    setHiddenColumns([]);
    setHiddenGroups([]);
  };

  const toggleColumn = (colId) => {
    setHiddenColumns(hiddenColumns.includes(colId)
      ? hiddenColumns.filter(id => id !== colId)
      : [...hiddenColumns, colId]);
  };

  const toggleGroup = (groupId) => {
    setHiddenGroups(hiddenGroups.includes(groupId)
      ? hiddenGroups.filter(id => id !== groupId)
      : [...hiddenGroups, groupId]);
  };

  const allGroups = board.groups || [];

  const completeRules = activeFilters.filter(f =>
    f.column_id && f.condition &&
    (NO_VALUE_CONDITIONS.has(f.condition) ? true : (Array.isArray(f.value) ? f.value.length > 0 : f.value?.length > 0))
  );

  const hasAnySettings = activeFilters.length > 0 || hiddenColumns.length > 0 || hiddenGroups.length > 0;

  const sectionHeader = (label, count, open, onToggle) => (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        padding: '6px 0', userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 11, color: '#9699a6', transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #323338)' }}>{label}</span>
      {count > 0 && (
        <span style={{ fontSize: 11, background: '#0073ea', color: '#fff', borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>{count}</span>
      )}
    </div>
  );

  return (
    <div style={{
      background: 'var(--card-bg, #fff)',
      border: '1px solid var(--border-color, #e6e9ef)',
      borderRadius: 8, padding: '12px 16px',
      margin: '0 16px 8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      flexShrink: 0,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #323338)' }}>
          View settings
        </span>
        {completeRules.length > 0 && (
          <span style={{ fontSize: 12, color: '#676879' }}>
            Showing {filteredItems} of {totalItems} item{totalItems !== 1 ? 's' : ''}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasAnySettings && (
            <button
              onClick={clearAll}
              style={{ fontSize: 12, color: '#e2445c', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >Clear all</button>
          )}
        </div>
      </div>

      {/* ── Scrollable sections wrapper ── */}
      <div style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 120px)' }}>

      {/* ── Section 1: Filter rows ── */}
      {sectionHeader('Filter items', completeRules.length, true, () => {})}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 16 }}>
        {activeFilters.map((rule, idx) => (
          <FilterRow
            key={rule.id || idx}
            rule={rule}
            cols={cols}
            boardMembers={board.members || []}
            onChange={updated => updateRule(idx, updated)}
            onRemove={() => removeRule(idx)}
            isFirst={idx === 0}
          />
        ))}
        <button
          onClick={addRule}
          style={{
            fontSize: 12, color: '#0073ea', fontWeight: 600, alignSelf: 'flex-start',
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
        >+ New filter</button>
      </div>

      {/* ── Section 2: Hide Columns ── */}
      <div style={{ borderTop: '1px solid var(--border-color, #e6e9ef)', marginTop: 10 }}>
        {sectionHeader('Hide columns', hiddenColumns.length, colSectionOpen, () => setColSectionOpen(o => !o))}
        {colSectionOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16, paddingBottom: 6 }}>
            {cols.map(col => {
              const isHidden = hiddenColumns.includes(col.id);
              return (
                <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => toggleColumn(col.id)}
                    style={{ accentColor: '#0073ea', cursor: 'pointer' }}
                  />
                  <span style={{ color: isHidden ? '#9699a6' : 'var(--text-primary, #323338)', textDecoration: isHidden ? 'line-through' : 'none' }}>
                    {col.title}
                  </span>
                </label>
              );
            })}
            {cols.length === 0 && <span style={{ fontSize: 12, color: '#9699a6' }}>No columns on this board</span>}
          </div>
        )}
      </div>

      {/* ── Section 3: Hide Groups ── */}
      <div style={{ borderTop: '1px solid var(--border-color, #e6e9ef)', marginTop: 2 }}>
        {sectionHeader('Hide groups', hiddenGroups.length, grpSectionOpen, () => setGrpSectionOpen(o => !o))}
        {grpSectionOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16, paddingBottom: 6 }}>
            {allGroups.map(grp => {
              const isHidden = hiddenGroups.includes(grp.id);
              return (
                <label key={grp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => toggleGroup(grp.id)}
                    style={{ accentColor: '#0073ea', cursor: 'pointer' }}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: isHidden ? '#9699a6' : 'var(--text-primary, #323338)', textDecoration: isHidden ? 'line-through' : 'none' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: grp.color || '#579bfc', flexShrink: 0 }} />
                    {grp.name}
                  </span>
                </label>
              );
            })}
            {allGroups.length === 0 && <span style={{ fontSize: 12, color: '#9699a6' }}>No groups on this board</span>}
          </div>
        )}
      </div>

      </div>{/* ── end scrollable sections wrapper ── */}

      {/* ── Save button ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, borderTop: '1px solid var(--border-color, #e6e9ef)', paddingTop: 10 }}>
        <button
          onClick={onSave}
          style={{
            padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: '#0073ea', color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            opacity: !hasAnySettings && !unsavedChanges ? 0.6 : 1,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0060c0'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0073ea'; }}
        >
          Save to this view{unsavedChanges ? ' ●' : ''}
        </button>
      </div>
    </div>
  );
}

// ── Filter logic ──────────────────────────────────────────────────────────────
function matchesFilter(item, rule) {
  const { column_id, column_type, condition, value } = rule;

  let itemValue;
  const colIdStr = String(column_id);
  if (colIdStr === 'name') {
    itemValue = item.name || '';
  } else {
    itemValue = item.values?.[column_id] || item.values?.[colIdStr] || '';
  }

  // Person columns store a JSON-encoded array (e.g. '["Alice","Bob"]').
  // Compare by parsing and checking set intersection instead of a raw string match.
  if (column_type === 'person') {
    const assigned = parseOwners(itemValue);
    const filterValues = Array.isArray(value) ? value : (value ? [value] : []);
    switch (condition) {
      case 'is':
        return filterValues.length === 0 || filterValues.some(v => assigned.includes(v));
      case 'is_not':
        return filterValues.length === 0 || !filterValues.some(v => assigned.includes(v));
      case 'is_empty':
        return assigned.length === 0;
      case 'is_not_empty':
        return assigned.length > 0;
      default:
        return true;
    }
  }

  switch (condition) {
    case 'is':
      if (Array.isArray(value)) return value.length === 0 || value.includes(itemValue);
      return itemValue === value;
    case 'is_not':
      if (Array.isArray(value)) return value.length === 0 || !value.includes(itemValue);
      return itemValue !== value;
    case 'is_empty':
      return !itemValue || itemValue === '';
    case 'is_not_empty':
      return !!itemValue && itemValue !== '';
    case 'contains':
      return String(itemValue).toLowerCase().includes(String(value).toLowerCase());
    case 'not_contains':
      return !String(itemValue).toLowerCase().includes(String(value).toLowerCase());
    case 'before':
      return !!itemValue && new Date(itemValue) < new Date(value);
    case 'after':
      return !!itemValue && new Date(itemValue) > new Date(value);
    case 'overdue': {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      return !!itemValue && new Date(itemValue) < now;
    }
    case 'today': {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const d = itemValue ? new Date(itemValue) : null;
      if (!d) return false;
      d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    }
    case 'this_week': {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
      const d = itemValue ? new Date(itemValue) : null;
      if (!d) return false;
      d.setHours(0, 0, 0, 0);
      return d >= now && d <= weekEnd;
    }
    case 'next_week': {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
      const nextWeekEnd = new Date(now); nextWeekEnd.setDate(now.getDate() + 14);
      const d = itemValue ? new Date(itemValue) : null;
      if (!d) return false;
      d.setHours(0, 0, 0, 0);
      return d > weekEnd && d <= nextWeekEnd;
    }
    default: return true;
  }
}


// ── VirtualisedGroups — renders all groups with row-level virtualisation ──────
function VirtualisedGroups({
  filteredGroups, cols, isManager, canEdit, scrollContainerRef,
  dropTarget, groupDragSrc, groupDropOver, selectedItems,
  handleGroupUpdate, handleGroupDelete, handleItemCreate, handleItemUpdate,
  handleItemDelete, handleItemCopy, handleValueChange, handleColumnSettingsSave,
  handleDragStart, handleDragEnd, handleDragOver, handleDrop, setDetailItemId,
  handleGroupDragStart, handleGroupDragEnd, handleGroupDragOver, handleGroupDrop,
  handleToggleSelect, handleSubitemCreate, handleSubitemUpdate,
  handleSubitemDelete, handleSubitemValueChange,
}) {
  // Track collapsed groups and expanded subitems locally
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [addingInGroup, setAddingInGroup] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const toast = useToast();

  const toggleGroup = (gid) => setCollapsedGroups(prev => {
    const n = new Set(prev); n.has(gid) ? n.delete(gid) : n.add(gid); return n;
  });
  const toggleExpand = (iid) => setExpandedItems(prev => {
    const n = new Set(prev); n.has(iid) ? n.delete(iid) : n.add(iid); return n;
  });

  // Flatten all groups into a single list of virtual rows
  const flatRows = useMemo(() => {
    const rows = [];
    for (const group of filteredGroups) {
      rows.push({ type: 'group-header', group, id: `gh-${group.id}` });
      if (collapsedGroups.has(group.id)) continue;
      for (const item of (group.items || [])) {
        rows.push({ type: 'item', item, group, id: `item-${item.id}` });
        if (expandedItems.has(item.id)) {
          for (const sub of (item.subitems || [])) {
            rows.push({ type: 'subitem', subitem: sub, item, group, id: `sub-${sub.id}` });
          }
          rows.push({ type: 'add-subitem', item, group, id: `add-sub-${item.id}` });
        }
      }
      rows.push({ type: 'add-item', group, id: `add-${group.id}` });
    }
    return rows;
  }, [filteredGroups, collapsedGroups, expandedItems]);

  const ROW_HEIGHT = 40;

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const handleAddItem = async (group) => {
    if (!newItemName.trim()) return;
    try {
      await handleItemCreate(group.id, newItemName.trim());
      setNewItemName('');
      setAddingInGroup(null);
    } catch { toast('Failed to add item', 'error'); }
  };

  const spanAll = cols.length + 5;
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <tbody>
      {/* Top padding row */}
      {virtualItems.length > 0 && virtualItems[0].start > 0 && (
        <tr><td colSpan={spanAll} style={{ height: virtualItems[0].start, padding: 0, border: 'none' }} /></tr>
      )}

      {virtualItems.map(vRow => {
        const row = flatRows[vRow.index];
        if (!row) return null;

        // ── Group header ──
        if (row.type === 'group-header') {
          const { group } = row;
          const collapsed = collapsedGroups.has(group.id);
          const groupItems = group.items || [];
          const selectedInGroup = groupItems.filter(i => selectedItems?.has(i.id));
          const groupAllSelected = groupItems.length > 0 && selectedInGroup.length === groupItems.length;
          const groupSomeSelected = selectedInGroup.length > 0 && !groupAllSelected;
          const handleGroupSelect = (e) => {
            e.stopPropagation();
            if (groupAllSelected) {
              groupItems.forEach(i => { if (selectedItems?.has(i.id)) handleToggleSelect(i.id); });
            } else {
              groupItems.forEach(i => { if (!selectedItems?.has(i.id)) handleToggleSelect(i.id); });
            }
          };
          return (
            <tr key={row.id} style={{ height: ROW_HEIGHT, background: groupDropOver === group.id ? '#e8f0fe' : 'var(--bg-primary)', borderTop: groupDropOver === group.id ? '3px solid #0073ea' : '6px solid var(--bg-secondary)', cursor: isManager ? 'grab' : 'default' }}
              draggable={isManager}
              onDragStart={isManager ? e => handleGroupDragStart(e, group.id) : undefined}
              onDragEnd={isManager ? handleGroupDragEnd : undefined}
              onDragOver={e => handleGroupDragOver(e, group.id)}
              onDrop={e => handleGroupDrop(e, group.id)}
            >
              <td colSpan={spanAll} style={{ padding: '0 8px 0 12px', borderLeft: `4px solid ${group.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={() => toggleGroup(group.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: group.color, transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</button>
                  {groupItems.length > 0 && (
                    <input
                      type="checkbox"
                      checked={groupAllSelected}
                      ref={el => { if (el) el.indeterminate = groupSomeSelected; }}
                      onChange={handleGroupSelect}
                      onClick={e => e.stopPropagation()}
                      title={groupAllSelected ? 'Deselect all in group' : 'Select all in group'}
                      style={{ cursor: 'pointer', accentColor: group.color, flexShrink: 0, width: 14, height: 14 }}
                    />
                  )}
                  <InlineEdit
                    value={group.name}
                    onSave={name => handleGroupUpdate(group.id, { name, color: group.color })}
                    singleClick={isManager}
                    style={{ fontWeight: 700, fontSize: 14, color: group.color }}
                    placeholder="Group name"
                  />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: group.color, borderRadius: 10, padding: '1px 7px', opacity: 0.85 }}>{group.items?.length || 0}</span>
                  {isManager && (
                    <button
                      onClick={() => { if (confirm('Delete this group and all its items?')) handleGroupDelete(group.id); }}
                      style={{ marginLeft: 8, color: '#c5c7d0', fontSize: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#e2445c'; e.currentTarget.style.borderColor = '#e2445c'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#c5c7d0'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                    >Delete group</button>
                  )}
                </div>
              </td>
            </tr>
          );
        }

        // ── Item row ──
        if (row.type === 'item') {
          const { item, group } = row;
          const isDropTarget = dropTarget?.groupId === group.id && dropTarget?.beforeItemId === item.id;
          return (
            <React.Fragment key={row.id}>
              {isDropTarget && <tr><td colSpan={spanAll} style={{ height: 3, background: '#0073ea', padding: 0 }} /></tr>}
              <ItemRow
                item={item}
                group={group}
                columns={cols}
                canEdit={canEdit}
                isManager={isManager}
                onItemUpdate={handleItemUpdate}
                onItemDelete={handleItemDelete}
                onItemCopy={handleItemCopy}
                onValueChange={handleValueChange}
                onEditSettings={handleColumnSettingsSave}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onOpenDetail={setDetailItemId}
                isSelected={selectedItems?.has(item.id)}
                onToggleSelect={handleToggleSelect}
                subitems={item.subitems || []}
                isExpanded={expandedItems.has(item.id)}
                onToggleExpand={() => toggleExpand(item.id)}
              />
            </React.Fragment>
          );
        }

        // ── Subitem row ──
        if (row.type === 'subitem') {
          const { subitem, item, group } = row;
          return (
            <SubitemRow
              key={row.id}
              subitem={subitem}
              group={group}
              columns={cols}
              canEdit={canEdit}
              isManager={isManager}
              onUpdate={(id, name) => handleSubitemUpdate(id, item.id, name)}
              onDelete={(id) => handleSubitemDelete(id, item.id)}
              onValueChange={(id, colId, val) => handleSubitemValueChange(id, item.id, colId, val)}
              onOpenDetail={setDetailItemId}
            />
          );
        }

        // ── Add subitem ──
        if (row.type === 'add-subitem') {
          const { item, group } = row;
          return (
            <tr key={row.id} style={{ height: 32 }}>
              <td colSpan={spanAll} style={{ paddingLeft: 60 }}>
                {canEdit && (
                  <button onClick={() => handleSubitemCreate(item.id, group.id, 'New subitem')}
                    style={{ fontSize: 12, color: '#0073ea', background: 'none', border: 'none', cursor: 'pointer' }}>
                    + Add subitem
                  </button>
                )}
              </td>
            </tr>
          );
        }

        // ── Add item row ──
        if (row.type === 'add-item') {
          const { group } = row;
          return (
            <tr key={row.id} style={{ height: 36, background: 'var(--bg-primary)' }}>
              <td colSpan={spanAll} style={{ paddingLeft: 16, borderLeft: `4px solid ${group.color}` }}>
                {canEdit && (
                  addingInGroup === group.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        autoFocus
                        value={newItemName}
                        onChange={e => setNewItemName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddItem(group); if (e.key === 'Escape') { setAddingInGroup(null); setNewItemName(''); } }}
                        onBlur={() => { if (newItemName.trim()) handleAddItem(group); else { setAddingInGroup(null); setNewItemName(''); } }}
                        placeholder="Item name…"
                        style={{ border: '1.5px solid #0073ea', borderRadius: 4, padding: '3px 8px', fontSize: 13, outline: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  ) : (
                    <button onClick={() => { setAddingInGroup(group.id); setNewItemName(''); }}
                      style={{ fontSize: 13, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      + Add Item
                    </button>
                  )
                )}
              </td>
            </tr>
          );
        }

        return null;
      })}

      {/* Bottom padding row */}
      {virtualItems.length > 0 && (() => {
        const last = virtualItems[virtualItems.length - 1];
        const bottom = totalSize - last.end;
        return bottom > 0 ? <tr><td colSpan={spanAll} style={{ height: bottom, padding: 0, border: 'none' }} /></tr> : null;
      })()}
    </tbody>
  );
}

// ── Main Board ────────────────────────────────────────────────────────────────
export default function Board({ board, onBoardChange, openItemId, onOpenItemDone }) {
  const scrollContainerRef = useRef(null);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [activeAutoCount, setActiveAutoCount] = useState(0);
  const [showForms, setShowForms] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [editingStatusCol, setEditingStatusCol] = useState(null);
  const [editingFormulaCol, setEditingFormulaCol] = useState(null);
  const [defaultEditor, setDefaultEditor] = useState(null); // { col, anchorRect }
  const toast = useToast();
  const { isManager, canEdit } = useAuth();
  const [filters, setFilters] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [activeFilters, setActiveFilters] = useState([]); // array of {id,column_id,column_type,condition,value}
  const [hiddenColumns, setHiddenColumns] = useState([]); // col IDs hidden in this view
  const [hiddenGroups, setHiddenGroups] = useState([]);   // group IDs hidden in this view
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [detailItemId, setDetailItemId] = useState(null);
  const [detailDefaultTab, setDetailDefaultTab] = useState('fields');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { csvRows } or null
  const importFileRef = React.useRef(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}/board/${board.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API not supported — show URL in a prompt as fallback
      prompt('Copy this board link:', url);
      return;
    }
    setShareCopied(true);
    toast('Board link copied to clipboard!', 'success');
    setTimeout(() => setShareCopied(false), 2000);
  };

  // Open item panel when triggered from a notification click
  useEffect(() => {
    if (!openItemId) return;
    const allItems = board.groups?.flatMap(g => [
      ...(g.items || []),
      ...(g.items || []).flatMap(i => i.subitems || []),
    ]);
    const exists = allItems?.some(i => i.id === openItemId);
    if (exists) {
      setDetailItemId(openItemId);
      setDetailDefaultTab('updates');
      onOpenItemDone?.();
    }
  }, [openItemId, board.groups]);

  // ── Column resizing ───────────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState({});
  const resizingRef = useRef(null);

  const getColWidth = (col) => colWidths[col.id] ?? colWidth(col);
  const getNameWidth = () => colWidths['_name'] ?? 240;

  const startResize = useCallback((e, key, currentWidth) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startWidth: currentWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev) => {
      const delta = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current.key]: newWidth }));
    };

    const onMouseUp = () => {
      resizingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const updateLocalBoard = useCallback((updater) => {
    onBoardChange(prev => ({ ...prev, ...updater(prev) }));
  }, [onBoardChange]);

  // ── View helpers ──────────────────────────────────────────────────────────
  // Handles old array format (just filter rules) and new object format
  const parseViewFilters = (raw) => {
    if (!raw) return { rules: [], hiddenColumns: [], hiddenGroups: [] };
    if (Array.isArray(raw)) return { rules: raw, hiddenColumns: [], hiddenGroups: [] };
    return {
      rules: raw.rules || [],
      hiddenColumns: raw.hiddenColumns || [],
      hiddenGroups: raw.hiddenGroups || [],
    };
  };

  // ── View handlers ─────────────────────────────────────────────────────────
  // The first view (by created_at ASC) is always the locked Main Table
  const mainViewId = views[0]?.id ?? null;
  const isMainView = activeViewId !== null && activeViewId === mainViewId;

  const handleSwitchView = (view) => {
    const isMain = view.id === mainViewId;
    setActiveViewId(view.id);
    if (isMain) {
      // Main Table is always pristine — no filters, no hidden columns/groups
      setActiveFilters([]);
      setHiddenColumns([]);
      setHiddenGroups([]);
      setFilterPanelOpen(false);
    } else {
      const { rules, hiddenColumns: hc, hiddenGroups: hg } = parseViewFilters(view.filters);
      setActiveFilters(rules);
      setHiddenColumns(hc);
      setHiddenGroups(hg);
    }
    setUnsavedChanges(false);
  };

  const handleViewCreate = async () => {
    try {
      const newView = await createView({ board_id: board.id, name: 'New View', type: 'table', filters: [] });
      setViews(prev => [...prev, newView]);
      setActiveViewId(newView.id);
      setActiveFilters([]);
      setHiddenColumns([]);
      setHiddenGroups([]);
      setUnsavedChanges(false);
      setFilterPanelOpen(true);
    } catch { toast('Failed to create view', 'error'); }
  };

  const handleViewRename = async (id, name) => {
    try {
      const updated = await updateView(id, { name });
      setViews(prev => prev.map(v => v.id === id ? { ...v, name: updated.name } : v));
    } catch { toast('Failed to rename view', 'error'); }
  };

  const handleViewDelete = async (id) => {
    if (views.length <= 1 || id === mainViewId) return;
    try {
      await deleteView(id);
      const remaining = views.filter(v => v.id !== id);
      setViews(remaining);
      if (activeViewId === id) {
        const { rules, hiddenColumns: hc, hiddenGroups: hg } = parseViewFilters(remaining[0].filters);
        setActiveViewId(remaining[0].id);
        setActiveFilters(rules);
        setHiddenColumns(hc);
        setHiddenGroups(hg);
        setUnsavedChanges(false);
      }
    } catch { toast('Failed to delete view', 'error'); }
  };

  const handleSaveView = async () => {
    if (!activeViewId || isMainView) return;
    try {
      const updated = await updateView(activeViewId, {
        filters: { rules: activeFilters, hiddenColumns, hiddenGroups },
      });
      setViews(prev => prev.map(v => v.id === activeViewId ? { ...v, filters: updated.filters } : v));
      setUnsavedChanges(false);
      toast('View saved!', 'success');
    } catch { toast('Failed to save view', 'error'); }
  };

  // Load trash count + active automation count when board changes
  useEffect(() => {
    getTrashItems(board.id).then(r => setTrashCount(r.data.length)).catch(() => { });
    getAutomations(board.id).then(r => setActiveAutoCount(r.data.filter(a => a.enabled).length)).catch(() => { });
  }, [board.id]);

  // Load views on board mount / board change
  useEffect(() => {
    getBoardViews(board.id).then(data => {
      setViews(data);
      const { rules, hiddenColumns: hc, hiddenGroups: hg } = parseViewFilters(data[0]?.filters);
      setActiveViewId(data[0]?.id ?? null);
      setActiveFilters(rules);
      setHiddenColumns(hc);
      setHiddenGroups(hg);
      setUnsavedChanges(false);
    }).catch(() => { });
  }, [board.id]);

  // Track viewport for mobile layout
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Multi-select ─────────────────────────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState(new Set());
  const selectAllCheckRef = useRef(null);

  const handleToggleSelect = useCallback((itemId) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }, []);

  const handleBulkMove = async (targetGroupId) => {
    const itemIds = [...selectedItems];
    const snapshot = board.groups;
    // Optimistic update
    updateLocalBoard(b => {
      const moving = [];
      let groups = b.groups.map(g => {
        const toMove = g.items.filter(i => itemIds.includes(i.id));
        moving.push(...toMove);
        return { ...g, items: g.items.filter(i => !itemIds.includes(i.id)) };
      });
      groups = groups.map(g =>
        g.id === targetGroupId ? { ...g, items: [...g.items, ...moving] } : g
      );
      return { groups };
    });
    setSelectedItems(new Set());
    try {
      const basePos = (board.groups.find(g => g.id === targetGroupId)?.items?.length) || 0;
      await Promise.all(itemIds.map((id, i) => moveItem(id, { group_id: targetGroupId, position: basePos + i })));
      toast(`${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} moved`, 'success');
    } catch {
      toast('Failed to move items', 'error');
      updateLocalBoard(() => ({ groups: snapshot }));
    }
  };

  // ── Drag & drop (items) ───────────────────────────────────────────────────
  const dragRef = useRef(null); // { itemId, sourceGroupId }
  const [dropTarget, setDropTarget] = useState(null); // { groupId, beforeItemId }

  // ── Group drag-to-reorder ─────────────────────────────────────────────────
  const groupDragRef = useRef(null); // group ID being dragged
  const [groupDragSrc, setGroupDragSrc] = useState(null);
  const [groupDropOver, setGroupDropOver] = useState(null);

  const handleGroupDragStart = useCallback((e, groupId) => {
    groupDragRef.current = groupId;
    setGroupDragSrc(groupId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `group:${groupId}`);
  }, []);

  const handleGroupDragEnd = useCallback(() => {
    groupDragRef.current = null;
    setGroupDragSrc(null);
    setGroupDropOver(null);
  }, []);

  const handleGroupDragOver = useCallback((e, targetGroupId) => {
    if (!groupDragRef.current || groupDragRef.current === targetGroupId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setGroupDropOver(prev => prev === targetGroupId ? prev : targetGroupId);
  }, []);

  const handleGroupDrop = useCallback(async (e, targetGroupId) => {
    e.preventDefault();
    const srcId = groupDragRef.current;
    groupDragRef.current = null;
    setGroupDragSrc(null);
    setGroupDropOver(null);
    if (!srcId || srcId === targetGroupId) return;
    const current = board.groups || [];
    const srcIdx = current.findIndex(g => g.id === srcId);
    const tgtIdx = current.findIndex(g => g.id === targetGroupId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const reordered = [...current];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);
    updateLocalBoard(() => ({ groups: reordered }));
    try {
      await reorderGroups(board.id, reordered.map(g => g.id));
    } catch {
      toast('Failed to reorder groups', 'error');
      updateLocalBoard(() => ({ groups: current }));
    }
  }, [board.groups, board.id, updateLocalBoard, toast]);

  const handleDragStart = useCallback((e, item, groupId) => {
    dragRef.current = { itemId: item.id, sourceGroupId: groupId };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(item.id)); // required for Firefox
    // Fade the row being dragged
    setTimeout(() => { if (e.target) e.target.style.opacity = '0.4'; }, 0);
  }, []);

  const handleDragEnd = useCallback((e) => {
    if (e.target) e.target.style.opacity = '';
    dragRef.current = null;
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((e, groupId, beforeItemId) => {
    if (groupDragRef.current) return; // group drag in progress — ignore item zones
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(prev =>
      prev?.groupId === groupId && prev?.beforeItemId === beforeItemId
        ? prev
        : { groupId, beforeItemId }
    );
  }, []);

  const handleDrop = useCallback(async (e, groupId, beforeItemId) => {
    if (groupDragRef.current) return; // group drag in progress — ignore item drop
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDropTarget(null);

    const { itemId, sourceGroupId } = drag;

    // Compute numeric insert position (ignoring the dragged item itself)
    const targetGroup = board.groups.find(g => g.id === groupId);
    const targetItems = (targetGroup?.items || []).filter(i => i.id !== itemId);
    const position = beforeItemId == null
      ? targetItems.length
      : Math.max(0, targetItems.findIndex(i => i.id === beforeItemId));

    // Optimistic local update
    updateLocalBoard(b => {
      const srcGroup = b.groups.find(g => g.id === sourceGroupId);
      const movingItem = srcGroup?.items.find(i => i.id === itemId);
      if (!movingItem) return {};

      let newGroups = b.groups.map(g => ({
        ...g,
        items: g.id === sourceGroupId ? g.items.filter(i => i.id !== itemId) : g.items,
      }));
      newGroups = newGroups.map(g => {
        if (g.id !== groupId) return g;
        const items = g.items.filter(i => i.id !== itemId); // also strip if same group
        const idx = beforeItemId == null ? items.length : items.findIndex(i => i.id === beforeItemId);
        const newItems = [...items];
        newItems.splice(idx === -1 ? items.length : idx, 0, movingItem);
        return { ...g, items: newItems };
      });
      return { groups: newGroups };
    });

    try {
      await moveItem(itemId, { group_id: groupId, position });
    } catch {
      toast('Failed to move item', 'error');
    }
  }, [board.groups, updateLocalBoard, toast]);

  // ── Groups ────────────────────────────────────────────────────────────────
  const handleGroupUpdate = async (id, data) => {
    try {
      const r = await updateGroup(id, data);
      updateLocalBoard(b => ({ groups: b.groups.map(g => g.id === id ? { ...g, ...r.data } : g) }));
    } catch { toast('Failed to update group', 'error'); }
  };

  const handleGroupCreate = async () => {
    try {
      const r = await createGroup({ board_id: board.id, name: 'New Group', color: GROUP_COLORS[board.groups.length % GROUP_COLORS.length] });
      updateLocalBoard(b => ({ groups: [...b.groups, { ...r.data, items: [] }] }));
      toast('Group added', 'success');
    } catch { toast('Failed to create group', 'error'); }
  };

  const handleGroupDelete = useCallback(async (id) => {
    if (!confirm('Delete this group and all its items?')) return;
    try {
      await deleteGroup(id);
      updateLocalBoard(b => ({ groups: b.groups.filter(g => g.id !== id) }));
      toast('Group deleted');
    } catch { toast('Failed to delete group', 'error'); }
  }, [updateLocalBoard, toast]);

  // ── Items ─────────────────────────────────────────────────────────────────
  const handleItemCreate = useCallback(async (groupId, name) => {
    const r = await createItem({ group_id: groupId, name });
    updateLocalBoard(b => ({ groups: b.groups.map(g => g.id === groupId ? { ...g, items: [...(g.items || []), r.data] } : g) }));
    if (r.data.triggeredAutomations?.length) fireAutomations(r.data.triggeredAutomations, toast);
    return r.data;
  }, [updateLocalBoard, toast]);

  const handleItemUpdate = useCallback(async (id, name) => {
    try {
      await updateItem(id, { name });
      updateLocalBoard(b => ({
        groups: b.groups.map(g => ({
          ...g,
          items: g.items.map(i => {
            if (i.id === id) return { ...i, name };
            if ((i.subitems || []).some(s => s.id === id)) {
              return { ...i, subitems: i.subitems.map(s => s.id === id ? { ...s, name } : s) };
            }
            return i;
          }),
        })),
      }));
    } catch { toast('Failed to rename item', 'error'); }
  }, [updateLocalBoard, toast]);

  const handleItemDelete = useCallback(async (id) => {
    try {
      await deleteItem(id);
      updateLocalBoard(b => ({ groups: b.groups.map(g => ({ ...g, items: g.items.filter(i => i.id !== id) })) }));
      setTrashCount(c => c + 1);
      toast('Item moved to Trash — restore it within 15 days');
    } catch { toast('Failed to delete item', 'error'); }
  }, [updateLocalBoard, setTrashCount, toast]);

  const handleItemCopy = useCallback(async (id) => {
    try {
      const r = await copyItem(id);
      const newItem = { ...r.data, subitems: [] };
      // Append copy at the end of the same group
      updateLocalBoard(b => ({
        groups: b.groups.map(g =>
          g.items.some(i => i.id === id)
            ? { ...g, items: [...g.items, newItem] }
            : g
        ),
      }));
      toast('Item duplicated', 'success');
    } catch { toast('Failed to duplicate item', 'error'); }
  }, [updateLocalBoard, toast]);

  const handleBulkDelete = async () => {
    const itemIds = [...selectedItems];
    if (!confirm(`Delete ${itemIds.length} selected item${itemIds.length !== 1 ? 's' : ''}? They will be moved to Trash.`)) return;
    // Optimistic update
    updateLocalBoard(b => ({
      groups: b.groups.map(g => ({ ...g, items: g.items.filter(i => !itemIds.includes(i.id)) })),
    }));
    setSelectedItems(new Set());
    setTrashCount(c => c + itemIds.length);
    try {
      await Promise.all(itemIds.map(id => deleteItem(id)));
      toast(`${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} moved to Trash`);
    } catch {
      toast('Some items could not be deleted', 'error');
    }
  };

  const handleTrashRestore = ({ item, group_id }) => {
    updateLocalBoard(b => ({
      groups: b.groups.map(g =>
        g.id === group_id ? { ...g, items: [...(g.items || []), { ...item, subitems: [] }] } : g
      ),
    }));
    toast('Item restored', 'success');
  };

  // ── Subitems ──────────────────────────────────────────────────────────────
  const handleSubitemCreate = useCallback(async (parentItemId, groupId, name) => {
    const r = await createItem({ group_id: groupId, name, parent_item_id: parentItemId });
    updateLocalBoard(b => ({
      groups: b.groups.map(g => ({
        ...g,
        items: g.items.map(i => i.id === parentItemId
          ? { ...i, subitems: [...(i.subitems || []), { ...r.data, subitems: [] }] }
          : i
        ),
      })),
    }));
    return r.data;
  }, [updateLocalBoard]);

  const handleSubitemUpdate = async (subitemId, parentItemId, name) => {
    try {
      await updateItem(subitemId, { name });
      updateLocalBoard(b => ({
        groups: b.groups.map(g => ({
          ...g,
          items: g.items.map(i => i.id === parentItemId
            ? { ...i, subitems: (i.subitems || []).map(s => s.id === subitemId ? { ...s, name } : s) }
            : i
          ),
        })),
      }));
    } catch { toast('Failed to rename subitem', 'error'); }
  };

  const handleSubitemDelete = async (subitemId, parentItemId) => {
    try {
      await deleteItem(subitemId);
      updateLocalBoard(b => ({
        groups: b.groups.map(g => ({
          ...g,
          items: g.items.map(i => i.id === parentItemId
            ? { ...i, subitems: (i.subitems || []).filter(s => s.id !== subitemId) }
            : i
          ),
        })),
      }));
      setTrashCount(c => c + 1);
    } catch { toast('Failed to delete subitem', 'error'); }
  };

  const handleSubitemValueChange = useCallback(async (subitemId, parentItemId, columnId, value) => {
    try {
      await upsertColumnValue({ item_id: subitemId, column_id: columnId, value });
      updateLocalBoard(b => ({
        groups: b.groups.map(g => ({
          ...g,
          items: g.items.map(i => i.id === parentItemId
            ? { ...i, subitems: (i.subitems || []).map(s => s.id === subitemId ? { ...s, values: { ...s.values, [columnId]: value } } : s) }
            : i
          ),
        })),
      }));
    } catch { toast('Failed to save value', 'error'); }
  }, [updateLocalBoard, toast]);

  // ── Column values ─────────────────────────────────────────────────────────
  const handleValueChange = useCallback(async (itemId, columnId, value) => {
    try {
      const r = await upsertColumnValue({ item_id: itemId, column_id: columnId, value });
      updateLocalBoard(b => {
        let groups = b.groups.map(g => ({
          ...g,
          items: g.items.map(i => {
            if (i.id === itemId) return { ...i, values: { ...i.values, [columnId]: value } };
            // Check subitems in case this is a subitem value update from detail panel
            if ((i.subitems || []).some(s => s.id === itemId)) {
              return { ...i, subitems: i.subitems.map(s => s.id === itemId ? { ...s, values: { ...s.values, [columnId]: value } } : s) };
            }
            return i;
          })
        }));
        if (r.data.movedItem) {
          const { id, old_group_id, group_id: newGid } = r.data.movedItem;
          const fromGroup = groups.find(g => g.id === old_group_id);
          const movingItem = fromGroup?.items.find(i => i.id === id);
          if (movingItem) {
            groups = groups.map(g => {
              if (g.id === old_group_id) return { ...g, items: g.items.filter(i => i.id !== id) };
              if (g.id === newGid) return { ...g, items: [...g.items, movingItem] };
              return g;
            });
          }
        }
        if (r.data.setValues?.length) {
          groups = groups.map(g => ({
            ...g,
            items: g.items.map(i => {
              if (i.id !== itemId) return i;
              const extra = {};
              r.data.setValues.forEach(sv => { extra[sv.column_id] = sv.value; });
              return { ...i, values: { ...i.values, ...extra } };
            })
          }));
        }
        return { groups };
      });
      if (r.data.triggeredAutomations?.length) fireAutomations(r.data.triggeredAutomations, toast);
      if (r.data.movedItem) toast('Item moved by automation', 'success');
    } catch { toast('Failed to save value', 'error'); }
  }, [updateLocalBoard, toast]);

  // ── Columns ───────────────────────────────────────────────────────────────
  const handleColumnAdd = async ({ title, type }) => {
    const finalType = type;
    let settings = {};
    if (type === 'person') {
      // Always keep as person type — multi-select avatars work for all board visibilities
      settings = { options: (board.members || []).map(m => m.name) };
    }
    try {
      const r = await createColumn({ board_id: board.id, title, type: finalType, settings });
      const newCol = r.data;
      updateLocalBoard(b => ({
        columns: [...b.columns, newCol],
        groups: b.groups.map(g => ({
          ...g,
          items: g.items.map(item => ({
            ...item,
            values: { ...item.values, [newCol.id]: '' },
            subitems: (item.subitems || []).map(sub => ({ ...sub, values: { ...sub.values, [newCol.id]: '' } })),
          })),
        })),
      }));
      setShowAddColumn(false);
      toast(`Column "${title}" added`, 'success');
    } catch (err) { toast(err.response?.data?.error || 'Failed to add column', 'error'); }
  };

  const handleColumnRename = async (id, title) => {
    try {
      const col = board.columns.find(c => c.id === id);
      const r = await updateColumn(id, { title, settings: col?.settings || {} });
      updateLocalBoard(b => ({ columns: b.columns.map(c => c.id === id ? r.data : c) }));
    } catch { toast('Failed to rename column', 'error'); }
  };

  const handleItemNameRename = async (newName) => {
    try {
      const r = await updateBoard(board.id, {
        name: board.name,
        description: board.description,
        visibility: board.visibility,
        item_name: newName,
      });
      updateLocalBoard(() => ({ item_name: r.data.item_name }));
    } catch { toast('Failed to rename Item column', 'error'); }
  };

  const handleColumnDelete = async (id) => {
    if (!confirm('Delete this column?')) return;
    try {
      await deleteColumn(id);
      updateLocalBoard(b => ({ columns: b.columns.filter(c => c.id !== id) }));
      toast('Column deleted');
    } catch { toast('Failed to delete column', 'error'); }
  };

  const handleColumnTypeChange = async (col, newType) => {
    if (col.type === newType) return;
    try {
      const r = await updateColumn(col.id, { type: newType });
      updateLocalBoard(b => ({ columns: b.columns.map(c => c.id === col.id ? r.data : c) }));
      toast(`Column type changed to ${newType}`, 'success');
    } catch { toast('Failed to change column type', 'error'); }
  };

  const handleStatusOptionsSave = async (options) => {
    if (!editingStatusCol) return;
    try {
      const r = await updateColumn(editingStatusCol.id, {
        title: editingStatusCol.title,
        settings: { ...editingStatusCol.settings, options },
      });
      updateLocalBoard(b => ({ columns: b.columns.map(c => c.id === editingStatusCol.id ? r.data : c) }));
      setEditingStatusCol(null);
      toast(`${editingStatusCol.type === 'dropdown' ? 'Dropdown' : 'Status'} options saved`, 'success');
    } catch { toast('Failed to save options', 'error'); }
  };

  const handleFormulaSave = async (newSettings) => {
    if (!editingFormulaCol) return;
    try {
      const r = await updateColumn(editingFormulaCol.id, { title: editingFormulaCol.title, settings: newSettings });
      updateLocalBoard(b => ({ columns: b.columns.map(c => c.id === editingFormulaCol.id ? r.data : c) }));
      setEditingFormulaCol(null);
      toast('Formula saved', 'success');
    } catch { toast('Failed to save formula', 'error'); }
  };

  // Called by StatusCell inline editor after a successful PUT /api/columns/:id
  const handleColumnSettingsSave = useCallback((updatedCol) => {
    updateLocalBoard(b => ({ columns: b.columns.map(c => c.id === updatedCol.id ? updatedCol : c) }));
  }, [updateLocalBoard]);

  const handleColumnToggleVisibility = async (colId) => {
    const col = board.columns.find(c => c.id === colId);
    if (!col) return;
    const nowOn = !col.settings?.isOwnerColumn;
    try {
      const r = await updateColumn(colId, {
        title: col.title,
        settings: { ...(col.settings || {}), isOwnerColumn: nowOn },
      });
      updateLocalBoard(b => ({ columns: b.columns.map(c => c.id === colId ? r.data : c) }));
      toast(nowOn ? '🔒 Visibility control ON — only assigned members will see restricted items' : '🔓 Visibility control OFF', nowOn ? 'success' : 'success');
    } catch { toast('Failed to update column', 'error'); }
  };

  // ── Column drag-to-reorder ────────────────────────────────────────────────
  const [boardSearch, setBoardSearch] = useState('');
  const [sortConfig, setSortConfig] = useState(null);
  const [colDragSrc, setColDragSrc] = useState(null);
  const [colDragOver, setColDragOver] = useState(null);

  const handleColDragStart = (e, colId) => {
    setColDragSrc(colId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleColDragOver = (e, colId) => {
    if (colDragSrc === null || colDragSrc === colId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (colDragOver !== colId) setColDragOver(colId);
  };

  const handleColDrop = async (e, targetColId) => {
    e.preventDefault();
    const srcId = colDragSrc;
    setColDragSrc(null);
    setColDragOver(null);
    if (!srcId || srcId === targetColId) return;

    const currentCols = board.columns || [];
    const srcIdx = currentCols.findIndex(c => c.id === srcId);
    const tgtIdx = currentCols.findIndex(c => c.id === targetColId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const reordered = [...currentCols];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);

    updateLocalBoard(b => ({ columns: reordered }));
    try {
      await reorderColumns(board.id, reordered.map(c => c.id));
    } catch {
      toast('Failed to reorder columns', 'error');
      updateLocalBoard(b => ({ columns: currentCols }));
    }
  };

  const handleColDragEnd = () => {
    setColDragSrc(null);
    setColDragOver(null);
  };

  const handleDefaultValueSave = async (colId, defaultValue) => {
    try {
      const col = board.columns.find(c => c.id === colId);
      if (!col) return;
      const r = await updateColumn(colId, {
        title: col.title,
        settings: { ...(col.settings || {}), defaultValue },
      });
      updateLocalBoard(b => ({ columns: b.columns.map(c => c.id === colId ? r.data : c) }));
      setDefaultEditor(null);
      toast(defaultValue !== '' ? 'Default value saved' : 'Default value cleared', 'success');
    } catch { toast('Failed to save default value', 'error'); }
  };

  // ── Visibility ────────────────────────────────────────────────────────────
  const handleVisibilityChange = async (visibility) => {
    try {
      const r = await updateBoard(board.id, { name: board.name, description: board.description, visibility });
      updateLocalBoard(() => ({ visibility: r.data.visibility }));
      toast(`Board is now ${visibility === 'private' ? '🔒 Private' : '🌐 Org-wide'}`, 'success');
    } catch { toast('Failed to update visibility', 'error'); }
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const r = await exportBoard(board.id);
      const cd = r.headers['content-disposition'] || '';
      const match = cd.match(/filename="(.+?)"/);
      const filename = match ? match[1] : `board_export.xlsx`;
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast('Board exported', 'success');
    } catch { toast('Export failed', 'error'); }
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) { toast('CSV is empty or invalid', 'error'); return; }
    // Show preview/validation modal instead of importing immediately
    setImportPreview({ csvRows: rows });
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    const { csvRows } = importPreview;
    setImportPreview(null);
    setImporting(true);
    try {
      const r = await importBoardRows(board.id, csvRows);
      const skipped = r.data.errors?.length || 0;
      toast(`Imported ${r.data.created} item(s)${skipped ? ` · ${skipped} row(s) skipped` : ''}`, 'success');
      if (skipped) console.warn('Import row errors:', r.data.errors);
      window.location.reload();
    } catch (err) {
      toast(err.response?.data?.error || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  // ── Members ───────────────────────────────────────────────────────────────
  const handleMembersChange = (members, updatedColumns) => {
    updateLocalBoard(b => {
      const update = { members };
      if (updatedColumns?.length) {
        update.columns = b.columns.map(c => {
          const synced = updatedColumns.find(uc => uc.id === c.id);
          return synced ? { ...c, settings: synced.settings } : c;
        });
      }
      return update;
    });
  };

  // Enrich person columns with board members as fallback options
  const memberNames = (board.members || []).map(m => m.name).filter(Boolean);
  const allCols = (board.columns || []).map(col =>
    col.type === 'person' && memberNames.length && !col.settings?.options?.length
      ? { ...col, settings: { ...(col.settings || {}), options: memberNames } }
      : col
  );
  // cols excludes columns hidden in the active view
  const cols = allCols.filter(col => !hiddenColumns.includes(col.id));
  const groups = board.groups || [];

  // Apply text-search filters (existing)
  const applyFilters = (grps) => {
    if (!filters.length) return grps;
    return grps.map(g => ({
      ...g,
      items: (g.items || []).filter(item => filters.every(f => {
        if (f.colId === '_name') return item.name.toLowerCase().includes(f.value.toLowerCase());
        if (!f.value) return true;
        const val = (item.values?.[f.colId] || '').toLowerCase();
        return val === f.value.toLowerCase() || val.includes(f.value.toLowerCase());
      }))
    }));
  };

  // Apply view-based filters (new — replaces applyAdvancedFilters)
  const applyViewFilters = useCallback((grps) => {
    const activeRules = activeFilters.filter(f =>
      f.column_id && f.condition &&
      (NO_VALUE_CONDITIONS.has(f.condition) ? true : (Array.isArray(f.value) ? f.value.length > 0 : (f.value?.length > 0)))
    );
    if (!activeRules.length) return grps;
    return grps
      .map(g => ({ ...g, items: (g.items || []).filter(item => activeRules.every(r => matchesFilter(item, r))) }))
      .filter(g => g.items.length > 0);
  }, [activeFilters]);

  const searchedGroups = boardSearch.trim()
    ? applyViewFilters(applyFilters(groups)).map(g => ({
      ...g,
      items: (g.items || []).filter(item => {
        const q = boardSearch.toLowerCase();
        if (item.name.toLowerCase().includes(q)) return true;
        return Object.values(item.values || {}).some(v => String(v).toLowerCase().includes(q));
      }),
    })).filter(g => g.items.length > 0)
    : applyViewFilters(applyFilters(groups));

  const filteredGroups = (sortConfig
    ? searchedGroups.map(g => ({
      ...g,
      items: [...(g.items || [])].sort((a, b) => {
        const aVal = sortConfig.colId === '_name' ? a.name : (a.values?.[sortConfig.colId] || '');
        const bVal = sortConfig.colId === '_name' ? b.name : (b.values?.[sortConfig.colId] || '');
        const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });
        return sortConfig.dir === 'asc' ? cmp : -cmp;
      }),
    }))
    : searchedGroups
  ).filter(g => !hiddenGroups.includes(g.id));

  // Counts for "Showing X of Y" display
  const totalItems = groups.reduce((s, g) => s + (g.items?.length || 0), 0);
  const filteredItems = filteredGroups.reduce((s, g) => s + (g.items?.length || 0), 0);
  const activeFilterCount = activeFilters.filter(f => f.column_id && f.condition).length;

  // ── Select-all header checkbox state ──────────────────────────────────────
  const allVisibleItemIds = filteredGroups.flatMap(g => (g.items || []).map(i => i.id));
  const allVisibleSelected = allVisibleItemIds.length > 0 && allVisibleItemIds.every(id => selectedItems.has(id));
  const someVisibleSelected = !allVisibleSelected && allVisibleItemIds.some(id => selectedItems.has(id));

  useEffect(() => {
    if (selectAllCheckRef.current) selectAllCheckRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const handleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(allVisibleItemIds));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVisibleSelected, allVisibleItemIds.join(',')]); // join for stable dep

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'Figtree, Roboto, -apple-system, sans-serif' }}>

      {/* ── Toolbar ── */}
      {isMobile ? (
        /* Mobile toolbar: Add Group + ⋯ More */
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', background: 'var(--bg-primary)',
          borderBottom: showFilters ? 'none' : '1px solid var(--border-color)', flexShrink: 0,
        }}>
          {isManager && (
            <button onClick={handleGroupCreate} style={{
              padding: '8px 14px', background: '#0073ea', color: '#fff',
              borderRadius: 6, fontWeight: 600, fontSize: 13, minHeight: 44,
            }}>+ Add Group</button>
          )}
          <button
            onClick={() => setShowMoreMenu(true)}
            style={{
              padding: '8px 14px', border: '1.5px solid var(--border-color)',
              borderRadius: 6, fontWeight: 600, fontSize: 13,
              color: 'var(--text-secondary)', background: 'var(--bg-primary)',
              minHeight: 44, display: 'flex', alignItems: 'center', gap: 5,
            }}
          >⋯ More</button>
          <button
            onClick={handleShare}
            style={{
              padding: '8px 12px', border: `1.5px solid ${shareCopied ? '#00c875' : 'var(--border-color)'}`,
              borderRadius: 6, fontWeight: 600, fontSize: 13, minHeight: 44,
              color: shareCopied ? '#00c875' : 'var(--text-secondary)', background: 'var(--bg-primary)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >{shareCopied ? '✓ Copied!' : '🔗'}</button>
          <div style={{ marginLeft: 'auto' }}>
            <VisibilityBadge visibility={board.visibility || 'org_wide'} onChange={handleVisibilityChange} isManager={isManager} />
          </div>
          <input ref={importFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImportFile} />
        </div>
      ) : (
        /* Desktop toolbar: full button row */
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 20px', background: 'var(--bg-primary)',
          borderBottom: 'none', flexShrink: 0, flexWrap: 'wrap',
        }}>
          {isManager && (
            <>
              <button onClick={handleGroupCreate} style={{
                padding: '6px 14px', background: '#0073ea', color: '#fff',
                borderRadius: 6, fontWeight: 600, fontSize: 13,
              }}>+ Add Group</button>
              <button onClick={() => setShowAutomations(true)} style={{
                padding: '5px 12px', border: '1.5px solid #a25ddc', color: '#a25ddc',
                borderRadius: 6, fontWeight: 600, fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                ⚡ Automations
                {activeAutoCount > 0 && (
                  <span style={{
                    background: '#a25ddc', color: '#fff', borderRadius: 10,
                    padding: '0px 6px', fontSize: 11, fontWeight: 700,
                  }}>{activeAutoCount}</span>
                )}
              </button>
              <button onClick={() => setShowForms(true)} style={{
                padding: '5px 12px', border: '1.5px solid #0073ea', color: '#0073ea',
                borderRadius: 6, fontWeight: 600, fontSize: 12,
              }}>
                📋 Forms
              </button>
            </>
          )}

          {/* Filter button — hidden on Main Table view */}
          {!isMainView && (() => {
            const totalCount = filters.length + activeFilterCount;
            const isActive = filterPanelOpen || totalCount > 0;
            return (
              <button onClick={() => setFilterPanelOpen(f => !f)} style={{
                padding: '5px 12px', border: `1.5px solid ${isActive ? '#0073ea' : 'var(--border-color)'}`,
                borderRadius: 6, fontSize: 12, fontWeight: 600,
                color: isActive ? '#0073ea' : '#676879',
                background: isActive ? '#e8f0fe' : 'var(--bg-primary)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                🔽 Filter{totalCount > 0 ? ` (${totalCount})` : ''}
              </button>
            );
          })()}

          {/* Board Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 8, fontSize: 12, color: '#9699a6', pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              value={boardSearch}
              onChange={e => setBoardSearch(e.target.value)}
              placeholder="Search board…"
              style={{
                paddingLeft: 26, paddingRight: boardSearch ? 22 : 8,
                paddingTop: 5, paddingBottom: 5,
                border: `1.5px solid ${boardSearch ? '#0073ea' : '#e6e9ef'}`,
                borderRadius: 6, fontSize: 12, fontWeight: 500,
                color: 'var(--text-primary)', background: 'var(--bg-primary)',
                outline: 'none', width: 180, transition: 'border-color 0.15s, width 0.2s',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.width = '240px'}
              onBlur={e => e.target.style.width = '180px'}
            />
            {boardSearch && (
              <span
                onClick={() => setBoardSearch('')}
                style={{ position: 'absolute', right: 6, fontSize: 14, color: '#9699a6', cursor: 'pointer', lineHeight: 1, fontWeight: 700 }}
              >×</span>
            )}
          </div>

          {sortConfig && (
            <button
              onClick={() => setSortConfig(null)}
              style={{
                padding: '5px 10px', border: '1.5px solid #0073ea', borderRadius: 6,
                fontSize: 12, fontWeight: 600, color: '#0073ea', background: '#e8f0fe',
                display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
              }}
              title="Clear sort"
            >
              {sortConfig.dir === 'asc' ? '↑' : '↓'} Sorted · ×
            </button>
          )}

          {/* Export / Import */}
          <button onClick={handleExport} style={{
            padding: '5px 12px', border: '1.5px solid #e6e9ef', borderRadius: 6,
            fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-primary)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>⬇️ Export</button>

          {canEdit && (
            <>
              <button
                onClick={() => importFileRef.current?.click()}
                disabled={importing}
                style={{
                  padding: '5px 12px', border: '1.5px solid #e6e9ef', borderRadius: 6,
                  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-primary)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  opacity: importing ? 0.6 : 1, cursor: importing ? 'not-allowed' : 'pointer',
                }}
              >{importing ? 'Importing…' : '⬆️ Import CSV'}</button>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
            </>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleShare}
              style={{
                padding: '6px 12px', border: `1px solid ${shareCopied ? '#00c875' : 'var(--border-color)'}`,
                borderRadius: 6, background: 'var(--bg-primary)', fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                color: shareCopied ? '#00c875' : 'var(--text-secondary)',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >{shareCopied ? '✓ Copied!' : '🔗 Share'}</button>
            <VisibilityBadge visibility={board.visibility || 'org_wide'} onChange={handleVisibilityChange} isManager={isManager} />
            <button onClick={() => setShowMembers(true)} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', border: '1.5px solid var(--border-color)', borderRadius: 6,
              fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-primary)',
            }}>👥 {board.members?.length || 0} Members</button>
            <button onClick={() => setShowActivityLog(true)} style={{
              padding: '5px 12px', border: '1.5px solid var(--border-color)', borderRadius: 6,
              fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-primary)',
            }}>📋 Activity</button>
            <button
              onClick={() => setShowTrash(true)}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: `1.5px solid ${trashCount > 0 ? '#e2445c' : '#e6e9ef'}`,
                color: trashCount > 0 ? '#e2445c' : '#676879',
                background: trashCount > 0 ? '#fff5f7' : 'var(--bg-primary)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              🗑️ Trash
              {trashCount > 0 && (
                <span style={{
                  background: '#e2445c', color: '#fff', borderRadius: 10,
                  padding: '0px 6px', fontSize: 11, fontWeight: 700,
                }}>{trashCount}</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── View tab bar (desktop only) ── */}
      {!isMobile && views.length > 0 && (
        <ViewTabBar
          views={views}
          activeViewId={activeViewId}
          mainViewId={mainViewId}
          unsavedChanges={unsavedChanges}
          onSwitch={handleSwitchView}
          onRename={handleViewRename}
          onDelete={handleViewDelete}
          onCreate={handleViewCreate}
          isManager={isManager}
        />
      )}

      {/* ── View filter panel (desktop only, not on Main Table) ── */}
      {!isMobile && filterPanelOpen && !isMainView && (
        <div style={{ flexShrink: 0, paddingTop: 8 }}>
          <ViewFilterPanel
            cols={allCols}
            board={board}
            activeFilters={activeFilters}
            setActiveFilters={(f) => { setActiveFilters(f); setUnsavedChanges(true); }}
            hiddenColumns={hiddenColumns}
            setHiddenColumns={(v) => { setHiddenColumns(v); setUnsavedChanges(true); }}
            hiddenGroups={hiddenGroups}
            setHiddenGroups={(v) => { setHiddenGroups(v); setUnsavedChanges(true); }}
            onSave={handleSaveView}
            unsavedChanges={unsavedChanges}
            totalItems={totalItems}
            filteredItems={filteredItems}
          />
        </div>
      )}

      {/* ── Filter bar (mobile / old text-search — kept for MoreBottomSheet) ── */}
      {showFilters && (
        <FilterBar cols={cols} filters={filters} onFiltersChange={setFilters} />
      )}

      {/* ── Board Content ── */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {groups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No groups yet</div>
            {isManager && <div style={{ fontSize: 13 }}>Click "+ Add Group" to get started</div>}
          </div>
        ) : isMobile ? (
          /* ── Mobile card view ── */
          <div style={{ padding: '12px 0' }}>
            {filteredGroups.map(group => (
              <MobileCardView
                key={group.id}
                group={group}
                columns={cols}
                canEdit={canEdit}
                isManager={isManager}
                onItemCreate={handleItemCreate}
                onItemUpdate={handleItemUpdate}
                onItemDelete={handleItemDelete}
                onValueChange={handleValueChange}
                onEditSettings={handleColumnSettingsSave}
                onOpenDetail={setDetailItemId}
              />
            ))}
          </div>
        ) : (
          /* ── Desktop table view ── */
          <table style={{
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            width: '100%',
            // Prevent columns shrinking when many are added — container scrolls instead
            minWidth: 6 + 36 + getNameWidth() + cols.reduce((s, c) => s + getColWidth(c), 0) + 36 + (isManager ? 48 : 0),
          }}>
            <colgroup>
              <col style={{ width: 6 }} />
              <col style={{ width: 36 }} />
              <col style={{ width: getNameWidth() }} />
              {cols.map(c => <col key={c.id} style={{ width: getColWidth(c) }} />)}
              <col style={{ width: 36 }} />
              <col style={{ width: isManager ? 48 : 0 }} />
            </colgroup>

            {/* ── Sticky header ── */}
            <thead style={{ position: 'sticky', top: 0, zIndex: 20 }}>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                <th style={{ padding: 0, background: 'var(--bg-secondary)', width: 6, position: 'sticky', left: 0, zIndex: 30 }} />
                <th style={{ padding: '0 8px', textAlign: 'center', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-color)', position: 'sticky', left: 6, zIndex: 30 }}>
                  <input
                    ref={selectAllCheckRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={handleSelectAll}
                    title={allVisibleSelected ? 'Deselect all' : 'Select all items'}
                    style={{ cursor: 'pointer', accentColor: '#0073ea' }}
                  />
                </th>
                <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRight: 'none', letterSpacing: '0.3px', position: 'sticky', left: 42, zIndex: 30, boxShadow: '2px 0 5px -2px rgba(0,0,0,0.15)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
                    {isManager
                      ? <InlineEdit
                        value={board.item_name || 'Item'}
                        onSave={handleItemNameRename}
                        style={{ fontSize: 12, fontWeight: 700, color: '#676879', flex: 1 }}
                      />
                      : <span style={{ fontSize: 12, fontWeight: 700, color: '#676879' }}>{board.item_name || 'Item'}</span>
                    }
                    <ResizeHandle onMouseDown={e => startResize(e, '_name', getNameWidth())} />
                  </div>
                </th>
                {cols.map(col => (
                  <th
                    key={col.id}
                    draggable={isManager}
                    onDragStart={isManager ? e => handleColDragStart(e, col.id) : undefined}
                    onDragOver={isManager ? e => handleColDragOver(e, col.id) : undefined}
                    onDrop={isManager ? e => handleColDrop(e, col.id) : undefined}
                    onDragEnd={isManager ? handleColDragEnd : undefined}
                    style={{
                      padding: '6px 8px',
                      background: colDragOver === col.id ? '#e8f0fe' : colDragSrc === col.id ? '#f0f4ff' : '#f5f6f8',
                      borderRight: colDragOver === col.id ? '2px solid #0073ea' : '1px solid #e6e9ef',
                      borderLeft: colDragOver === col.id ? '2px solid #0073ea' : undefined,
                      textAlign: 'left',
                      position: 'relative',
                      cursor: isManager ? (colDragSrc === col.id ? 'grabbing' : 'grab') : 'default',
                      opacity: colDragSrc === col.id ? 0.45 : 1,
                      transition: 'background 0.1s, opacity 0.1s',
                    }}
                  >
                    <ColumnHeader
                      col={col}
                      onRename={handleColumnRename}
                      onDelete={handleColumnDelete}
                      onEditStatus={setEditingStatusCol}
                      onEditFormula={setEditingFormulaCol}
                      onChangeType={handleColumnTypeChange}
                      onSetDefault={(c, anchorRect) => setDefaultEditor({ col: c, anchorRect })}
                      onToggleVisibility={handleColumnToggleVisibility}
                      isManager={isManager}
                      sortConfig={sortConfig}
                      onSort={(colId, dir) => colId ? setSortConfig({ colId, dir }) : setSortConfig(null)}
                    />
                    <ResizeHandle onMouseDown={e => startResize(e, col.id, getColWidth(col))} />
                  </th>
                ))}
                <th style={{ background: '#f5f6f8', borderRight: '1px solid #e6e9ef' }} />
                {isManager && (
                  <th style={{ background: '#f5f6f8', textAlign: 'center', padding: '0 4px' }}>
                    <button
                      onClick={() => setShowAddColumn(true)}
                      title="Add column"
                      style={{
                        width: 30, height: 30, borderRadius: '50%', background: '#e6e9ef',
                        color: '#676879', fontSize: 20, lineHeight: '28px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', margin: '0 auto',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#0073ea'; e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#e6e9ef'; e.currentTarget.style.color = '#676879'; }}
                    >+</button>
                  </th>
                )}
              </tr>
            </thead>

            {/* ── Groups (virtualised) ── */}
            <VirtualisedGroups
              filteredGroups={filteredGroups}
              cols={cols}
              isManager={isManager}
              canEdit={canEdit}
              scrollContainerRef={scrollContainerRef}
              dropTarget={dropTarget}
              groupDragSrc={groupDragSrc}
              groupDropOver={groupDropOver}
              selectedItems={selectedItems}
              handleGroupUpdate={handleGroupUpdate}
              handleGroupDelete={handleGroupDelete}
              handleItemCreate={handleItemCreate}
              handleItemUpdate={handleItemUpdate}
              handleItemDelete={handleItemDelete}
              handleItemCopy={handleItemCopy}
              handleValueChange={handleValueChange}
              handleColumnSettingsSave={handleColumnSettingsSave}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
              handleDragOver={handleDragOver}
              handleDrop={handleDrop}
              setDetailItemId={setDetailItemId}
              handleGroupDragStart={handleGroupDragStart}
              handleGroupDragEnd={handleGroupDragEnd}
              handleGroupDragOver={handleGroupDragOver}
              handleGroupDrop={handleGroupDrop}
              handleToggleSelect={handleToggleSelect}
              handleSubitemCreate={handleSubitemCreate}
              handleSubitemUpdate={handleSubitemUpdate}
              handleSubitemDelete={handleSubitemDelete}
              handleSubitemValueChange={handleSubitemValueChange}
            />
          </table>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {selectedItems.size > 0 && (
        <BulkActionBar
          count={selectedItems.size}
          groups={groups}
          onMove={handleBulkMove}
          onDelete={handleBulkDelete}
          onClear={() => setSelectedItems(new Set())}
        />
      )}

      {/* ── Mobile More bottom sheet ── */}
      {showMoreMenu && (
        <MoreBottomSheet
          isManager={isManager}
          canEdit={canEdit}
          activeAutoCount={activeAutoCount}
          trashCount={trashCount}
          importing={importing}
          filtersActive={showFilters || filters.length > 0 || activeFilterCount > 0}
          boardMembersCount={board.members?.length || 0}
          onClose={() => setShowMoreMenu(false)}
          onAutomations={() => setShowAutomations(true)}
          onForms={() => setShowForms(true)}
          onFilter={() => setShowFilters(f => !f)}
          onExport={handleExport}
          onImport={() => importFileRef.current?.click()}
          onMembers={() => setShowMembers(true)}
          onActivity={() => setShowActivityLog(true)}
          onTrash={() => setShowTrash(true)}
        />
      )}

      {/* ── Modals & panels ── */}
      {detailItemId && (() => {
        const allBoardItems = board.groups.flatMap(g => [
          ...(g.items || []),
          ...(g.items || []).flatMap(i => i.subitems || []),
        ]);
        const detailItem = allBoardItems.find(i => i.id === detailItemId);
        const detailGroup = board.groups.find(g =>
          g.items.some(i => i.id === detailItemId) ||
          g.items.some(i => (i.subitems || []).some(s => s.id === detailItemId))
        );
        if (!detailItem || !detailGroup) return null;
        return (
          <ItemDetailPanel
            item={detailItem}
            group={detailGroup}
            columns={cols}
            boardId={board.id}
            canEdit={canEdit}
            isManager={isManager}
            defaultTab={detailDefaultTab}
            onClose={() => { setDetailItemId(null); setDetailDefaultTab('fields'); }}
            onItemUpdate={handleItemUpdate}
            onValueChange={(colId, val) => handleValueChange(detailItemId, colId, val)}
          />
        );
      })()}

      {showAddColumn && <AddColumnModal onAdd={handleColumnAdd} onClose={() => setShowAddColumn(false)} />}

      {showTrash && (
        <TrashPanel
          boardId={board.id}
          onClose={() => setShowTrash(false)}
          onRestore={handleTrashRestore}
          onCountChange={setTrashCount}
        />
      )}

      {editingStatusCol && (
        <StatusOptionsEditor
          column={editingStatusCol}
          onSave={handleStatusOptionsSave}
          onClose={() => setEditingStatusCol(null)}
        />
      )}

      {editingFormulaCol && (
        <FormulaEditor
          column={editingFormulaCol}
          columns={board.columns || []}
          previewItem={board.groups?.[0]?.items?.[0] || null}
          onSave={handleFormulaSave}
          onClose={() => setEditingFormulaCol(null)}
        />
      )}

      {showAutomations && (
        <AutomationsLazy
          boardId={board.id}
          columns={cols}
          groups={groups}
          boardEmailFrom={board.email_from || ''}
          onBoardEmailFromChange={async (val) => {
            await updateBoardEmailSettings(board.id, val);
            updateLocalBoard(() => ({ email_from: val }));
          }}
          onClose={() => setShowAutomations(false)}
          onCountChange={setActiveAutoCount}
        />
      )}

      {showMembers && (
        <BoardMembersPanel
          board={board}
          onClose={() => setShowMembers(false)}
          onMembersChange={handleMembersChange}
        />
      )}

      {showActivityLog && (
        <Suspense fallback={null}>
          <ActivityLogPanel boardId={board.id} onClose={() => setShowActivityLog(false)} />
        </Suspense>
      )}

      {defaultEditor && (
        <DefaultValueEditor
          col={defaultEditor.col}
          anchorRect={defaultEditor.anchorRect}
          onSave={(val) => handleDefaultValueSave(defaultEditor.col.id, val)}
          onClose={() => setDefaultEditor(null)}
        />
      )}

      {showForms && (
        <FormsLazy
          boardId={board.id}
          groups={groups}
          columns={cols}
          onClose={() => setShowForms(false)}
        />
      )}

      {importPreview && (
        <ImportPreviewModal
          csvRows={importPreview.csvRows}
          boardColumns={cols}
          boardGroups={groups}
          onConfirm={handleConfirmImport}
          onCancel={() => setImportPreview(null)}
        />
      )}
    </div>
  );
}

function FormsLazy(props) {
  const FormsPanel = lazy(() => import('./FormsPanel'));
  return (
    <Suspense fallback={null}>
      <FormsPanel {...props} />
    </Suspense>
  );
}

function AutomationsLazy(props) {
  const AutomationsPanel = lazy(() => import('./AutomationsPanel'));
  return (
    <Suspense fallback={null}>
      <AutomationsPanel {...props} />
    </Suspense>
  );
}
