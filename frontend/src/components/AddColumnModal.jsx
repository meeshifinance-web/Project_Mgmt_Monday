import React, { useEffect, useRef, useState } from 'react';
import { getBoards, getConnectionColumns } from '../api';
import { AI_OPS } from '../utils/aiColumn';

const COLUMN_TYPES = [
  // Essentials
  { value: 'status',        label: 'Status',        icon: '◉',  color: '#00c875', group: 'essentials' },
  { value: 'dropdown',      label: 'Dropdown',      icon: '▾',  color: '#00c875', group: 'essentials' },
  { value: 'text',          label: 'Text',          icon: 'T',  color: '#fdab3d', group: 'essentials' },
  { value: 'date',          label: 'Date',          icon: '📅', color: '#a25ddc', group: 'essentials' },
  { value: 'person',        label: 'People',        icon: '👤', color: '#579bfc', group: 'essentials' },
  { value: 'number',        label: 'Numbers',       icon: '½',  color: '#fdab3d', group: 'essentials' },

  // Super useful
  { value: 'file',          label: 'Files',         icon: '📎', color: '#ff642e', group: 'useful' },
  { value: 'checkbox',      label: 'Checkbox',      icon: '✓',  color: '#fdab3d', group: 'useful' },
  { value: 'formula',       label: 'Formula',       icon: 'ƒ',  color: '#00c875', group: 'useful' },
  { value: 'priority',      label: 'Priority',      icon: '▲',  color: '#fdab3d', group: 'useful' },
  { value: 'timeline',      label: 'Timeline',      icon: '▭',  color: '#a25ddc', group: 'useful' },
  { value: 'rating',        label: 'Rating',        icon: '★',  color: '#fdab3d', group: 'useful' },
  { value: 'dependency',    label: 'Dependency',    icon: '⛓',  color: '#ff642e', group: 'useful' },
  { value: 'ai',            label: 'AI Column',     icon: '✨', color: '#9b72f5', group: 'useful' },

  // Connect & roll-up (cross-board)
  { value: 'connect_boards', label: 'Connect Boards', icon: '🔗', color: '#0073ea', group: 'connect' },
  { value: 'mirror',         label: 'Mirror',         icon: '🪞', color: '#00a9ff', group: 'connect' },
  { value: 'rollup',         label: 'Rollup',         icon: 'Σ',  color: '#7e3af2', group: 'connect' },

  // More
  { value: 'long_text',     label: 'Long Text',     icon: '¶',  color: '#9aa5b8', group: 'more' },
  { value: 'link',          label: 'Link',          icon: '🔗', color: '#66ccff', group: 'more' },
  { value: 'email',         label: 'Email',         icon: '✉',  color: '#66ccff', group: 'more' },
  { value: 'phone',         label: 'Phone',         icon: '☏',  color: '#00c875', group: 'more' },
  { value: 'progress',      label: 'Progress',      icon: '▰',  color: '#00c875', group: 'more' },
  { value: 'tags',          label: 'Tags',          icon: '#',  color: '#ff7575', group: 'more' },
  { value: 'color_picker',  label: 'Color',         icon: '◎',  color: '#ff158a', group: 'more' },
  { value: 'time_tracking', label: 'Time Tracking', icon: '⏱',  color: '#9aa5b8', group: 'more' },
  { value: 'location',      label: 'Location',      icon: '📍', color: '#ff642e', group: 'more' },
  { value: 'creation_log',  label: 'Creation Log',  icon: '🪵', color: '#9aa5b8', group: 'more' },
];

const GROUPS = [
  { key: 'essentials', label: 'Essentials' },
  { key: 'useful',     label: 'Super useful' },
  { key: 'connect',    label: 'Connect & roll-up' },
  { key: 'more',       label: 'More columns' },
];

const CONFIGURABLE = new Set(['connect_boards', 'mirror', 'rollup', 'dependency', 'ai']);
const AI_EXTRACT = [['email', 'Emails'], ['phone', 'Phone numbers'], ['url', 'Links'], ['number', 'Numbers']];
const ROLLUP_FNS = [
  ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max'],
  ['median', 'Median'], ['count', 'Count (links)'], ['count_filled', 'Count filled'], ['count_unique', 'Count unique'],
  ['earliest', 'Earliest date'], ['latest', 'Latest date'], ['range', 'Date range'],
];

const inputStyle = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--border-color)',
  borderRadius: 7, padding: '8px 10px', fontSize: 13, background: 'var(--input-bg, var(--bg-secondary))',
  color: 'var(--text-primary)', outline: 'none',
};
const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, display: 'block' };

export default function AddColumnModal({ onAdd, onClose, currentBoardId, currentColumns = [] }) {
  const [query, setQuery] = useState('');
  const [hoverKey, setHoverKey] = useState(null);
  const [config, setConfig] = useState(null); // { type } when configuring a cross-board column
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { config ? setConfig(null) : onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, config]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? COLUMN_TYPES.filter(c => c.label.toLowerCase().includes(q) || c.value.includes(q))
    : COLUMN_TYPES;

  const handlePick = (ct) => {
    if (CONFIGURABLE.has(ct.value)) { setConfig({ type: ct.value }); return; }
    onAdd({ title: ct.label, type: ct.value });
  };

  const Tile = ({ ct }) => (
    <div
      key={ct.value}
      onClick={() => handlePick(ct)}
      onMouseEnter={() => setHoverKey(ct.value)}
      onMouseLeave={() => setHoverKey(null)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
        background: hoverKey === ct.value ? 'var(--menu-hover)' : 'transparent',
        transition: 'background 0.12s ease',
      }}
    >
      <div style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        background: ct.color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, lineHeight: 1,
      }}>{ct.icon}</div>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{ct.label}</span>
    </div>
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card-bg)', border: '1px solid var(--menu-border)', borderRadius: 12,
          width: 440, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--menu-shadow, 0 12px 40px rgba(0,0,0,0.35))', overflow: 'hidden',
        }}
      >
        {config ? (
          <ConfigPanel
            type={config.type}
            currentBoardId={currentBoardId}
            currentColumns={currentColumns}
            onBack={() => setConfig(null)}
            onAdd={onAdd}
          />
        ) : (
          <>
            {/* Search */}
            <div style={{ padding: 12, borderBottom: '1px solid var(--menu-divider)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>🔍</span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search or describe your column"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: '8px 12px 14px', overflowY: 'auto' }}>
              {q ? (
                matches.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                    No column types match "{query}"
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, paddingTop: 6 }}>
                    {matches.map(ct => <Tile key={ct.value} ct={ct} />)}
                  </div>
                )
              ) : (
                GROUPS.map(g => {
                  const items = COLUMN_TYPES.filter(c => c.group === g.key);
                  if (!items.length) return null;
                  return (
                    <div key={g.key} style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 8px', letterSpacing: 0.2 }}>
                        {g.label}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                        {items.map(ct => <Tile key={ct.value} ct={ct} />)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Config panel for Connect Boards / Mirror / Rollup ──────────────────────────
function ConfigPanel({ type, currentBoardId, currentColumns, onBack, onAdd }) {
  const [title, setTitle] = useState(
    type === 'connect_boards' ? 'Connect Boards' : type === 'mirror' ? 'Mirror' : type === 'dependency' ? 'Dependency' : type === 'ai' ? 'AI Column' : 'Rollup'
  );
  const isAi = type === 'ai';
  const [aiOp, setAiOp] = useState('summary');
  const [aiSource, setAiSource] = useState('');
  const [aiExtract, setAiExtract] = useState('email');
  const aiTextCols = currentColumns.filter(c => ['text', 'long_text', 'email', 'link'].includes(c.type));
  const aiNeedsSource = aiOp === 'extract' || aiOp === 'sentiment';
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [twoWay, setTwoWay] = useState(true);

  // mirror / rollup
  const connectColumns = currentColumns.filter(c => c.type === 'connect_boards');
  const [connectColumnId, setConnectColumnId] = useState(connectColumns[0]?.id ?? '');
  const [targetColumns, setTargetColumns] = useState([]);
  const [sourceColumnId, setSourceColumnId] = useState('');
  const [fn, setFn] = useState('sum');
  const [loadingCols, setLoadingCols] = useState(false);

  const isConnect = type === 'connect_boards';
  const needsConnectColumn = type === 'mirror' || type === 'rollup';
  const isDependency = type === 'dependency';

  // dependency: pick the timeline column that holds each task's schedule
  const timelineColumns = currentColumns.filter(c => c.type === 'timeline');
  const [scheduleColumnId, setScheduleColumnId] = useState(timelineColumns[0]?.id ?? '');
  const [autoShift, setAutoShift] = useState(true);
  const [lag, setLag] = useState(0);

  // Load boards for the Connect picker (exclude trashed; allow same board too).
  useEffect(() => {
    if (!isConnect) return;
    getBoards().then(r => {
      const list = (r.data || []).filter(b => !b.is_deleted);
      setBoards(list);
      setBoardId(prev => prev || String(list[0]?.id || ''));
    }).catch(() => setBoards([]));
  }, [isConnect]);

  // For mirror/rollup: load the connected board's columns when the chosen
  // connect column changes.
  const selectedConnect = connectColumns.find(c => String(c.id) === String(connectColumnId));
  const targetBoardId = selectedConnect?.settings?.boardId;
  useEffect(() => {
    if (!needsConnectColumn || !targetBoardId) { setTargetColumns([]); return; }
    setLoadingCols(true);
    getConnectionColumns(targetBoardId)
      .then(cols => {
        setTargetColumns(cols || []);
        setSourceColumnId(prev => prev || String((cols || [])[0]?.id || ''));
      })
      .catch(() => setTargetColumns([]))
      .finally(() => setLoadingCols(false));
  }, [needsConnectColumn, targetBoardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rollup ideally aggregates numeric columns; surface those first but allow any.
  const sourceOptions = type === 'rollup'
    ? [...targetColumns].sort((a, b) => (a.type === 'number' ? -1 : 0) - (b.type === 'number' ? -1 : 0))
    : targetColumns;

  const canSubmit = (() => {
    if (!title.trim()) return false;
    if (isAi) return !aiNeedsSource || !!aiSource;
    if (isConnect) return !!boardId;
    if (isDependency) return !!scheduleColumnId;
    return !!connectColumnId && !!sourceColumnId;
  })();

  const submit = () => {
    if (!canSubmit) return;
    if (isAi) {
      onAdd({ title: title.trim(), type, settings: { op: aiOp, sourceColumnId: aiSource ? Number(aiSource) : undefined, extract: aiExtract } });
      return;
    }
    if (isDependency) {
      onAdd({ title: title.trim(), type, settings: { boardId: Number(currentBoardId), scheduleColumnId: Number(scheduleColumnId), autoShift, lag: Number(lag) || 0 } });
      return;
    }
    if (isConnect) {
      const sameBoard = String(boardId) === String(currentBoardId);
      onAdd({ title: title.trim(), type, settings: { boardId: Number(boardId), allowMultiple, twoWay: twoWay && !sameBoard } });
    } else if (type === 'mirror') {
      onAdd({ title: title.trim(), type, settings: { connectColumnId: Number(connectColumnId), sourceColumnId: Number(sourceColumnId) } });
    } else {
      onAdd({ title: title.trim(), type, settings: { connectColumnId: Number(connectColumnId), sourceColumnId: Number(sourceColumnId), fn } });
    }
  };

  const heading = isConnect ? '🔗 Connect Boards' : type === 'mirror' ? '🪞 Mirror column' : isDependency ? '⛓ Dependency column' : isAi ? '✨ AI Column' : 'Σ Rollup column';
  const blurb = isConnect
    ? 'Link items on this board to items in another board.'
    : type === 'mirror'
      ? 'Show a column from the linked items, read-only.'
      : isDependency
        ? 'Mark which tasks each item waits for. When a task slips, dependents auto-shift and the critical path is highlighted.'
        : isAi
          ? 'Derives a value per row from your other columns — summary, health, extract, or sentiment. Recomputes live.'
          : 'Aggregate a column from the linked items into one value.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '82vh' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--menu-divider)' }}>
        <button onClick={onBack} style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, marginBottom: 8 }}>← Back</button>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{heading}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{blurb}</div>
      </div>

      <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Column name</label>
          <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder="Column name" />
        </div>

        {isConnect && (
          <>
            <div>
              <label style={labelStyle}>Connect to board</label>
              <select value={boardId} onChange={e => setBoardId(e.target.value)} style={inputStyle}>
                {boards.length === 0 && <option value="">Loading boards…</option>}
                {boards.map(b => (
                  <option key={b.id} value={b.id}>{b.name}{String(b.id) === String(currentBoardId) ? ' (this board)' : ''}</option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={allowMultiple} onChange={e => setAllowMultiple(e.target.checked)} style={{ accentColor: '#0073ea', width: 15, height: 15 }} />
              Allow linking multiple items
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: String(boardId) === String(currentBoardId) ? 'not-allowed' : 'pointer', opacity: String(boardId) === String(currentBoardId) ? 0.5 : 1 }}>
              <input type="checkbox" checked={twoWay && String(boardId) !== String(currentBoardId)} disabled={String(boardId) === String(currentBoardId)} onChange={e => setTwoWay(e.target.checked)} style={{ accentColor: '#0073ea', width: 15, height: 15, marginTop: 2 }} />
              <span>Create a two-way connection<br /><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Adds a matching column on the other board (not available for same-board links)</span></span>
            </label>
          </>
        )}

        {isAi && (
          <>
            <div>
              <label style={labelStyle}>What should it do?</label>
              <select value={aiOp} onChange={e => setAiOp(e.target.value)} style={inputStyle}>
                {AI_OPS.map(([v, l, d]) => <option key={v} value={v}>{l} — {d}</option>)}
              </select>
            </div>
            {aiNeedsSource && (
              <div>
                <label style={labelStyle}>From which text column?</label>
                {aiTextCols.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Add a Text / Long Text column first.</div>
                  : <select value={aiSource} onChange={e => setAiSource(e.target.value)} style={inputStyle}>
                      <option value="">— Select —</option>
                      {aiTextCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>}
              </div>
            )}
            {aiOp === 'extract' && (
              <div>
                <label style={labelStyle}>Extract</label>
                <select value={aiExtract} onChange={e => setAiExtract(e.target.value)} style={inputStyle}>
                  {AI_EXTRACT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {isDependency && (
          timelineColumns.length === 0 ? (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              ⚠ Add a <b>Timeline</b> column first — dependencies shift each task's start/end dates, so they need a schedule to move.
            </div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>Schedule (timeline) column</label>
                <select value={scheduleColumnId} onChange={e => setScheduleColumnId(e.target.value)} style={inputStyle}>
                  {timelineColumns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={autoShift} onChange={e => setAutoShift(e.target.checked)} style={{ accentColor: '#ff642e', width: 15, height: 15, marginTop: 2 }} />
                <span>Auto-shift dependent tasks<br /><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>When a task slips, push tasks that depend on it forward automatically</span></span>
              </label>
              <div>
                <label style={labelStyle}>Lag (days between tasks)</label>
                <input type="number" min="0" value={lag} onChange={e => setLag(e.target.value)} style={{ ...inputStyle, width: 120 }} />
              </div>
            </>
          )
        )}

        {needsConnectColumn && (
          connectColumns.length === 0 ? (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              ⚠ This board has no <b>Connect Boards</b> column yet. Add one first — Mirror and Rollup pull their data through a connection.
            </div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>Through connection</label>
                <select value={connectColumnId} onChange={e => { setConnectColumnId(e.target.value); setSourceColumnId(''); }} style={inputStyle}>
                  {connectColumns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{type === 'rollup' ? 'Roll up column' : 'Column to mirror'}</label>
                <select value={sourceColumnId} onChange={e => setSourceColumnId(e.target.value)} style={inputStyle} disabled={loadingCols || !targetColumns.length}>
                  {loadingCols && <option value="">Loading columns…</option>}
                  {!loadingCols && !targetColumns.length && <option value="">No columns on connected board</option>}
                  {sourceOptions.map(c => <option key={c.id} value={c.id}>{c.title} · {c.type}</option>)}
                </select>
              </div>
              {type === 'rollup' && (
                <div>
                  <label style={labelStyle}>Aggregate</label>
                  <select value={fn} onChange={e => setFn(e.target.value)} style={inputStyle}>
                    {ROLLUP_FNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
            </>
          )
        )}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--menu-divider)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onBack} style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button onClick={submit} disabled={!canSubmit}
          style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: canSubmit ? '#0073ea' : 'var(--border-color)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          Add column
        </button>
      </div>
    </div>
  );
}
