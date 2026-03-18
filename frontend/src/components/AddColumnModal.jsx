import React, { useState } from 'react';

const COLUMN_TYPES = [
  { value: 'text',          label: 'Text',         icon: '📝' },
  { value: 'long_text',     label: 'Long Text',    icon: '📄' },
  { value: 'number',        label: 'Number',       icon: '🔢' },
  { value: 'status',        label: 'Status',       icon: '🔵' },
  { value: 'date',          label: 'Date',         icon: '📅' },
  { value: 'person',        label: 'Person',       icon: '👤' },
  { value: 'checkbox',      label: 'Checkbox',     icon: '☑️' },
  { value: 'dropdown',      label: 'Dropdown',     icon: '▼' },
  { value: 'link',          label: 'Link',         icon: '🔗' },
  { value: 'email',         label: 'Email',        icon: '✉️' },
  { value: 'phone',         label: 'Phone',        icon: '📞' },
  { value: 'rating',        label: 'Rating',       icon: '⭐' },
  { value: 'progress',      label: 'Progress',     icon: '📊' },
  { value: 'timeline',      label: 'Timeline',     icon: '📆' },
  { value: 'tags',          label: 'Tags',         icon: '🏷️' },
  { value: 'color_picker',  label: 'Color',        icon: '🎨' },
  { value: 'file',          label: 'File',         icon: '📁' },
  { value: 'time_tracking', label: 'Time Tracking',icon: '⏱️' },
  { value: 'priority',      label: 'Priority',     icon: '🔺' },
  { value: 'formula',       label: 'Formula',      icon: '🧮' },
  { value: 'location',      label: 'Location',     icon: '📍' },
  { value: 'creation_log', label: 'Creation Log', icon: '🪵' },
];

export default function AddColumnModal({ onAdd, onClose }) {
  const [type, setType] = useState('text');
  const [title, setTitle] = useState('Text');

  const selectType = (ct) => {
    setType(ct.value);
    setTitle(ct.label);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd({ title: title.trim(), type });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, padding: 24, width: 440,
        boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700, color: '#323338' }}>Add Column</h3>
        <form onSubmit={handleSubmit}>

          {/* Type grid — pick first */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>Select Column Type</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {COLUMN_TYPES.map(ct => (
                <div
                  key={ct.value}
                  onClick={() => selectType(ct)}
                  style={{
                    border: `2px solid ${type === ct.value ? '#0073ea' : '#e0e0e0'}`,
                    borderRadius: 8, padding: '8px 4px', textAlign: 'center',
                    cursor: 'pointer',
                    background: type === ct.value ? '#e3f0ff' : '#fff',
                    transition: 'all 0.12s',
                  }}
                >
                  <div style={{ fontSize: 16 }}>{ct.icon}</div>
                  <div style={{ fontSize: 10, marginTop: 2, color: type === ct.value ? '#0073ea' : '#666', fontWeight: type === ct.value ? 700 : 400 }}>{ct.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Column name — auto-filled, editable */}
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>Column Name</p>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Column name"
              style={{
                width: '100%', border: '1.5px solid #0073ea', borderRadius: 8,
                padding: '8px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{
              padding: '8px 18px', border: '1px solid #ddd', borderRadius: 8,
              color: '#555', cursor: 'pointer', fontSize: 13,
            }}>Cancel</button>
            <button type="submit" style={{
              padding: '8px 20px', background: '#0073ea', color: '#fff',
              borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}>Add Column</button>
          </div>
        </form>
      </div>
    </div>
  );
}
