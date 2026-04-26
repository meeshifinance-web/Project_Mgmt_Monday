import React, { useState, useEffect } from 'react';
import { getTrashItems, restoreTrashItem, deleteTrashItem, emptyTrash } from '../api';

export default function TrashPanel({ boardId, onClose, onRestore, onCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false); // for empty-trash confirm

  const load = async () => {
    setLoading(true);
    try {
      const r = await getTrashItems(boardId);
      setItems(r.data);
      onCountChange?.(r.data.length);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [boardId]);

  const handleRestore = async (trashId) => {
    try {
      const r = await restoreTrashItem(trashId);
      const next = items.filter(i => i.id !== trashId);
      setItems(next);
      onCountChange?.(next.length);
      onRestore(r.data); // { item, group_id }
    } catch (_) {}
  };

  const handleDelete = async (trashId) => {
    try {
      await deleteTrashItem(trashId);
      const next = items.filter(i => i.id !== trashId);
      setItems(next);
      onCountChange?.(next.length);
    } catch (_) {}
  };

  const handleEmpty = async () => {
    try {
      await emptyTrash(boardId);
      setItems([]);
      onCountChange?.(0);
      setConfirming(false);
    } catch (_) {}
  };

  const daysLeft = (item) => Math.max(0, Math.ceil(Number(item.days_left) || 0));

  const formatDate = (ts) =>
    new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 399, background: 'rgba(0,0,0,0.25)' }}
      />

      {/* Panel */}
      <div className="wb-side-panel" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, zIndex: 400,
        background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Figtree, Roboto, -apple-system, sans-serif',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e6e9ef',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 20 }}>🗑️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#323338' }}>Trash</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
              Items are permanently deleted after 15 days
            </div>
          </div>
          {items.length > 0 && !confirming && (
            <button
              onClick={() => setConfirming(true)}
              style={{
                padding: '5px 12px', border: '1.5px solid #e2445c', borderRadius: 6,
                fontSize: 12, fontWeight: 600, color: '#e2445c', cursor: 'pointer', background: '#fff',
              }}
            >
              Empty Trash
            </button>
          )}
          <button
            onClick={onClose}
            style={{ fontSize: 22, color: '#888', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
          >×</button>
        </div>

        {/* Empty-trash confirmation bar */}
        {confirming && (
          <div style={{
            padding: '10px 20px', background: '#fff5f7', borderBottom: '1px solid #ffd0d8',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ flex: 1, fontSize: 13, color: '#323338', fontWeight: 500 }}>
              Permanently delete all {items.length} items?
            </span>
            <button
              onClick={handleEmpty}
              style={{
                padding: '5px 14px', background: '#e2445c', color: '#fff',
                borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >Yes, delete all</button>
            <button
              onClick={() => setConfirming(false)}
              style={{
                padding: '5px 12px', border: '1px solid #ddd', borderRadius: 6,
                fontSize: 12, color: '#555', cursor: 'pointer',
              }}
            >Cancel</button>
          </div>
        )}

        {/* Item list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 13 }}>
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#323338' }}>
                Trash is empty
              </div>
              <div style={{ fontSize: 12 }}>Deleted items appear here for 15 days</div>
            </div>
          ) : (
            items.map(item => {
              const left = daysLeft(item);
              const urgent = left <= 3;
              return (
                <div key={item.id} style={{
                  background: '#fafbfd', border: `1px solid ${urgent ? '#ffd0d8' : '#e6e9ef'}`,
                  borderRadius: 8, padding: '12px 14px', marginBottom: 8,
                  transition: 'border-color 0.15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Item name */}
                      <div style={{
                        fontWeight: 600, fontSize: 13, color: '#323338', marginBottom: 4,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{item.name}</div>

                      {/* Meta */}
                      <div style={{ fontSize: 11, color: '#888', lineHeight: 1.6 }}>
                        <span>From group: </span>
                        <span style={{ color: '#555', fontWeight: 500 }}>{item.group_name || '—'}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#888', lineHeight: 1.6 }}>
                        <span>Deleted by: </span>
                        <span style={{ color: '#555', fontWeight: 500 }}>
                          {item.deleted_by_user_name || 'Unknown'}
                        </span>
                        <span> · {formatDate(item.deleted_at)}</span>
                      </div>
                    </div>

                    {/* Days-left badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12,
                      background: urgent ? '#ffe8ec' : '#f0f6ff',
                      color: urgent ? '#e2445c' : '#0073ea',
                      flexShrink: 0, whiteSpace: 'nowrap',
                    }}>
                      {left}d left
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button
                      onClick={() => handleRestore(item.id)}
                      style={{
                        flex: 1, padding: '6px 0', background: '#00c875', color: '#fff',
                        borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#00b468'}
                      onMouseLeave={e => e.currentTarget.style.background = '#00c875'}
                    >
                      ↩ Restore
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      style={{
                        padding: '6px 14px', border: '1.5px solid #e2445c', borderRadius: 6,
                        fontSize: 12, fontWeight: 600, color: '#e2445c', cursor: 'pointer',
                        background: '#fff',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#e2445c'; e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#e2445c'; }}
                      title="Permanently delete"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
