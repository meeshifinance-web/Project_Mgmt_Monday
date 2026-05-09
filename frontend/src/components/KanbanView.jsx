import React, { useState } from 'react';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

function KanbanCard({ item, group, statusColId, columns, onValueChange, onItemDelete }) {
  const [hovered, setHovered] = useState(false);

  // Pick a couple of non-status columns to preview
  const previewCols = columns.filter(c => c.type !== 'status' && c.id !== statusColId).slice(0, 3);

  return (
    <div
      style={{
        background: 'var(--card-bg)', borderRadius: 8, padding: '10px 12px',
        boxShadow: hovered ? '0 4px 16px rgba(0,0,0,0.12)' : '0 1px 4px rgba(0,0,0,0.08)',
        border: `1px solid ${hovered ? '#c0d4f5' : 'var(--border-color)'}`,
        cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Group color indicator */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: group.color, borderRadius: '8px 0 0 8px' }} />
      <div style={{ paddingLeft: 8 }}>
        {/* Item name */}
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: previewCols.length ? 6 : 0 }}>
          {item.name}
        </div>
        {/* Preview column values */}
        {previewCols.map(col => {
          const val = item.values?.[col.id];
          if (!val) return null;
          return (
            <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{col.title}:</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
            </div>
          );
        })}
        {/* Group label */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, background: `${group.color}20`, color: group.color, borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>
            {group.name}
          </span>
          {hovered && (
            <button
              onClick={e => { e.stopPropagation(); onItemDelete(item.id); }}
              style={{ color: '#ccc', fontSize: 16, lineHeight: 1 }}
              onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
              onMouseLeave={e => e.currentTarget.style.color = '#ccc'}
              title="Delete item"
            >×</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function KanbanView({ groups, columns, onValueChange, onItemCreate, onItemDelete, isManager }) {
  const toast = useToast();
  const [addingIn, setAddingIn] = useState(null); // statusLabel being added to
  const [newName, setNewName] = useState('');

  const statusCol = columns.find(c => c.type === 'status');
  if (!statusCol) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
        <div>Add a Status column to use Kanban view</div>
      </div>
    );
  }

  const statusOptions = statusCol.settings?.options || [];
  const allCols = [
    ...statusOptions,
    { label: '', color: '#c4c4c4' }, // "No Status" bucket
  ];

  // Build map: statusLabel → items (with group ref)
  const byStatus = {};
  for (const opt of allCols) byStatus[opt.label] = [];
  for (const g of groups) {
    for (const item of g.items || []) {
      const val = item.values?.[statusCol.id] || '';
      if (byStatus[val] !== undefined) byStatus[val].push({ item, group: g });
      else byStatus[''].push({ item, group: g });
    }
  }

  const handleAddItem = async (statusLabel) => {
    if (!newName.trim()) return;
    const firstGroup = groups[0];
    if (!firstGroup) { toast('Add a group first', 'error'); return; }
    try {
      const created = await onItemCreate(firstGroup.id, newName.trim());
      if (statusLabel && created) {
        await onValueChange(created.id, statusCol.id, statusLabel, statusCol.title);
      }
      setNewName('');
      setAddingIn(null);
    } catch { toast('Failed to add item', 'error'); }
  };

  return (
    <div style={{ flex: 1, overflowX: 'auto', padding: '16px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', height: '100%' }}>
      {allCols.map(opt => {
        const cards = byStatus[opt.label] || [];
        const isNoStatus = opt.label === '';
        const label = isNoStatus ? 'No Status' : opt.label;
        const color = opt.color || '#c4c4c4';

        return (
          <div key={opt.label || '__none__'} style={{
            width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: 'var(--bg-secondary)', borderRadius: 10, overflow: 'hidden',
          }}>
            {/* Column header */}
            <div style={{ padding: '10px 12px 8px', borderBottom: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{label}</span>
              <span style={{ background: `${color}25`, color, borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{cards.length}</span>
            </div>

            {/* Cards */}
            <div style={{ padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
              {cards.map(({ item, group }) => (
                <KanbanCard
                  key={item.id}
                  item={item}
                  group={group}
                  statusColId={statusCol.id}
                  columns={columns}
                  onValueChange={onValueChange}
                  onItemDelete={onItemDelete}
                />
              ))}

              {/* Add item in this column */}
              {isManager && (
                addingIn === opt.label ? (
                  <div style={{ background: 'var(--input-bg)', borderRadius: 8, padding: '8px 10px', border: '1.5px solid #9b72f5' }}>
                    <input
                      autoFocus type="text" value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddItem(opt.label); if (e.key === 'Escape') { setAddingIn(null); setNewName(''); } }}
                      onBlur={() => { if (!newName.trim()) { setAddingIn(null); } }}
                      placeholder="Item name…"
                      style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, background: 'transparent', color: 'var(--text-primary)' }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button onClick={() => handleAddItem(opt.label)} style={{ background: '#9b72f5', color: '#fff', borderRadius: 5, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>Add</button>
                      <button onClick={() => { setAddingIn(null); setNewName(''); }} style={{ color: '#888', fontSize: 12 }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingIn(opt.label); setNewName(''); }}
                    style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, padding: '6px 4px', textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#9b72f5'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                  >+ Add Item</button>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
