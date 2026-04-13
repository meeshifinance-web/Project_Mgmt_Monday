import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import {
  getDashboardWidgets, createDashboardWidget, updateDashboardWidget,
  deleteDashboardWidget, updateDashboard, getBoard,
} from '../api';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const CHART_COLORS = ['#0073ea','#00c875','#fdab3d','#e2445c','#a25ddc','#037f4c','#ff7575','#7e3af2','#0086c0','#579bfc'];

const WIDGET_DEFS = [
  { type: 'kpi',       label: 'Numbers',           icon: '🔢', desc: 'A key metric as a big number — count, sum, or average',  defaultW: 4  },
  { type: 'chart',     label: 'Chart',              icon: '📊', desc: 'Pie, donut, or bar chart by status / column value',     defaultW: 6  },
  { type: 'battery',   label: 'Battery',            icon: '🔋', desc: 'Horizontal progress bars showing status distribution',  defaultW: 6  },
  { type: 'deadlines', label: 'Upcoming Deadlines', icon: '📅', desc: 'Items with approaching or overdue dates',               defaultW: 6  },
  { type: 'workload',  label: 'Workload',           icon: '👥', desc: 'Item count per assigned person',                        defaultW: 6  },
  { type: 'summary',   label: 'Summary Table',      icon: '📋', desc: 'Item counts per group in a clean table',               defaultW: 6  },
  { type: 'text',      label: 'Text / Notes',       icon: '📝', desc: 'Free-form text — announcements, sprint notes, etc.',   defaultW: 4  },
];

// ── Data utilities ────────────────────────────────────────────────────────────
function getFilteredItems(boardData, group_ids) {
  if (!boardData) return [];
  const groups = boardData.groups || [];
  const filtered = group_ids?.length ? groups.filter(g => group_ids.includes(String(g.id))) : groups;
  return filtered.flatMap(g => g.items || []);
}

function computeKpi(boardData, config) {
  const items = getFilteredItems(boardData, config.group_ids);
  const { column_id, metric = 'count' } = config;
  if (!column_id || metric === 'count') return items.length;
  const vals = items.map(i => parseFloat(i.values?.[column_id])).filter(v => !isNaN(v));
  if (!vals.length) return 0;
  if (metric === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (metric === 'avg') return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
  return vals.length;
}

function computeStatusDist(boardData, config) {
  const { column_id, group_ids } = config;
  if (!column_id || !boardData) return [];
  const col = boardData.columns?.find(c => String(c.id) === String(column_id));
  const options = col?.settings?.options || [];
  const items = getFilteredItems(boardData, group_ids);
  const counts = {};
  items.forEach(item => {
    const v = item.values?.[column_id] || '';
    counts[v] = (counts[v] || 0) + 1;
  });
  return options
    .map(opt => ({ name: opt.label, value: counts[opt.label] || 0, color: opt.color || '#c4c4c4' }))
    .concat(
      Object.entries(counts)
        .filter(([k]) => !options.find(o => o.label === k))
        .map(([k, v]) => ({ name: k || 'Empty', value: v, color: '#c4c4c4' }))
    )
    .filter(d => d.value > 0);
}

function computeWorkload(boardData, config) {
  const { column_id, group_ids } = config;
  if (!column_id || !boardData) return [];
  const items = getFilteredItems(boardData, group_ids);
  const counts = {};
  items.forEach(item => {
    let raw = item.values?.[column_id] || '';
    let owners = [];
    try { owners = JSON.parse(raw); if (!Array.isArray(owners)) owners = [String(raw)]; } catch { owners = raw ? [raw] : []; }
    if (!owners.length) owners = ['Unassigned'];
    owners.forEach(o => { counts[o] = (counts[o] || 0) + 1; });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
}

function computeDeadlines(boardData, config) {
  const { column_id, group_ids, days_ahead = 7 } = config;
  if (!column_id || !boardData) return [];
  const items = getFilteredItems(boardData, group_ids);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now); cutoff.setDate(now.getDate() + Number(days_ahead));
  const result = [];
  items.forEach(item => {
    const raw = item.values?.[column_id];
    if (!raw) return;
    const d = new Date(raw); d.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((d - now) / 86400000);
    // Show overdue + within range
    if (diffDays <= Number(days_ahead)) {
      result.push({ id: item.id, name: item.name, date: d, diffDays, raw });
    }
  });
  return result.sort((a, b) => a.date - b.date).slice(0, 20);
}

function computeGroupSummary(boardData, config) {
  if (!boardData) return [];
  const { group_ids } = config;
  const groups = boardData.groups || [];
  const filtered = group_ids?.length ? groups.filter(g => group_ids.includes(String(g.id))) : groups;
  return filtered.map(g => ({ id: g.id, name: g.name, color: g.color || '#579bfc', count: (g.items || []).length }));
}

// ── Shared card shell ─────────────────────────────────────────────────────────
function WidgetCard({ widget, onEdit, onDelete, isManager, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: `span ${widget.grid_w || 6}`,
        background: 'var(--card-bg, #fff)',
        borderRadius: 12,
        boxShadow: hovered ? '0 6px 24px rgba(0,0,0,0.12)' : '0 2px 8px rgba(0,0,0,0.07)',
        border: '1px solid var(--border-color, #e6e9ef)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'box-shadow 0.2s',
        minHeight: 180,
      }}
    >
      {/* Card header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px 8px',
        borderBottom: '1px solid var(--border-color, #f0f0f0)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #676879)', letterSpacing: 0.2 }}>
          {widget.title || WIDGET_DEFS.find(d => d.type === widget.type)?.label || widget.type}
        </span>
        {isManager && hovered && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => onEdit(widget)}
              title="Configure widget"
              style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: '#f0f4ff', color: '#0073ea', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = '#dce8ff'}
              onMouseLeave={e => e.currentTarget.style.background = '#f0f4ff'}
            >⚙</button>
            <button
              onClick={() => onDelete(widget.id)}
              title="Delete widget"
              style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: '#fff5f5', color: '#e2445c', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = '#ffe8ec'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff5f5'}
            >×</button>
          </div>
        )}
      </div>
      {/* Card body */}
      <div style={{ flex: 1, padding: '12px 16px 16px', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

// ── KPI Widget ────────────────────────────────────────────────────────────────
function KpiWidget({ boardData, config }) {
  const value = computeKpi(boardData, config);
  const color = config.color || '#0073ea';
  const label = config.label || (config.metric === 'count' ? 'Total Items' : config.metric === 'sum' ? 'Total' : 'Average');
  const formatted = typeof value === 'number' && value >= 1000
    ? value.toLocaleString()
    : String(value);
  if (!boardData) return <SkeletonPulse height={80} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, padding: '8px 0' }}>
      <div style={{
        fontSize: 48, fontWeight: 800, color,
        lineHeight: 1, letterSpacing: -2,
        fontVariantNumeric: 'tabular-nums',
      }}>{formatted}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary, #676879)', fontWeight: 500, textAlign: 'center' }}>{label}</div>
    </div>
  );
}

// ── Chart Widget (Pie / Donut / Bar) ──────────────────────────────────────────
function ChartWidget({ boardData, config }) {
  const data = computeStatusDist(boardData, config);
  const chartType = config.chart_type || 'donut';
  if (!boardData) return <SkeletonPulse height={200} />;
  if (!data.length) return <EmptyWidgetState text="No data — select a status or dropdown column" />;

  if (chartType === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color,#e6e9ef)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => <Cell key={i} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const inner = chartType === 'donut' ? '52%' : '0%';
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data} dataKey="value" nameKey="name"
          cx="50%" cy="50%" outerRadius="80%"
          innerRadius={inner}
          paddingAngle={chartType === 'donut' ? 2 : 0}
        >
          {data.map((entry, i) => <Cell key={i} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
        <Legend
          iconType="circle" iconSize={8}
          formatter={(value) => <span style={{ fontSize: 11, color: 'var(--text-secondary,#676879)' }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Battery Widget ────────────────────────────────────────────────────────────
function BatteryWidget({ boardData, config }) {
  const data = computeStatusDist(boardData, config);
  if (!boardData) return <SkeletonPulse height={120} />;
  if (!data.length) return <EmptyWidgetState text="No data — select a status or dropdown column" />;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', background: '#f0f0f0' }}>
        {data.map((d, i) => (
          <div
            key={i}
            title={`${d.name}: ${d.value} (${total ? Math.round(d.value / total * 100) : 0}%)`}
            style={{ width: `${total ? (d.value / total * 100) : 0}%`, background: d.color || CHART_COLORS[i % CHART_COLORS.length], transition: 'width 0.4s' }}
          />
        ))}
      </div>
      {/* Legend rows */}
      {data.map((d, i) => {
        const pct = total ? Math.round(d.value / total * 100) : 0;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color || CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text-primary,#323338)', flex: 1 }}>{d.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 80, height: 6, borderRadius: 3, background: '#f0f0f0', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: d.color || CHART_COLORS[i % CHART_COLORS.length], transition: 'width 0.4s' }} />
              </div>
              <span style={{ fontSize: 11, color: '#9699a6', fontWeight: 600, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
              <span style={{ fontSize: 11, color: '#9699a6', minWidth: 20, textAlign: 'right' }}>{d.value}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Deadlines Widget ──────────────────────────────────────────────────────────
function DeadlinesWidget({ boardData, config, onOpenItem }) {
  const items = computeDeadlines(boardData, config);
  if (!boardData) return <SkeletonPulse height={120} />;
  if (!items.length) return <EmptyWidgetState text="No upcoming deadlines in this range" />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => {
        const isOverdue = item.diffDays < 0;
        const isToday   = item.diffDays === 0;
        const color = isOverdue ? '#e2445c' : isToday ? '#fdab3d' : '#00c875';
        const label = isOverdue ? `${Math.abs(item.diffDays)}d overdue` : isToday ? 'Today' : `In ${item.diffDays}d`;
        return (
          <div
            key={item.id}
            onClick={() => onOpenItem?.(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 10px', borderRadius: 8,
              background: 'var(--bg-secondary,#f5f6f8)',
              cursor: onOpenItem ? 'pointer' : 'default',
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => { if (onOpenItem) e.currentTarget.style.background = '#eef2fb'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-secondary,#f5f6f8)'}
          >
            <span style={{ fontSize: 13, flex: 1, color: 'var(--text-primary,#323338)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, color, background: `${color}20`,
              borderRadius: 10, padding: '2px 8px', flexShrink: 0,
            }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Workload Widget ───────────────────────────────────────────────────────────
function WorkloadWidget({ boardData, config }) {
  const data = computeWorkload(boardData, config);
  if (!boardData) return <SkeletonPulse height={120} />;
  if (!data.length) return <EmptyWidgetState text="No data — select a person column" />;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.slice(0, 10).map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: CHART_COLORS[i % CHART_COLORS.length],
            color: '#fff', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {d.name.slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-primary,#323338)', width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{d.name}</span>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden' }}>
            <div style={{
              width: `${(d.value / max) * 100}%`, height: '100%',
              background: CHART_COLORS[i % CHART_COLORS.length],
              borderRadius: 4, transition: 'width 0.4s',
            }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#676879', minWidth: 24, textAlign: 'right' }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Summary Table Widget ──────────────────────────────────────────────────────
function SummaryWidget({ boardData, config }) {
  const rows = computeGroupSummary(boardData, config);
  if (!boardData) return <SkeletonPulse height={120} />;
  if (!rows.length) return <EmptyWidgetState text="No groups found" />;
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border-color,#e6e9ef)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#9699a6', fontWeight: 700, letterSpacing: 0.3 }}>GROUP</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: '#9699a6', fontWeight: 700, letterSpacing: 0.3 }}>ITEMS</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: '#9699a6', fontWeight: 700, letterSpacing: 0.3 }}>SHARE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--border-color,#f0f0f0)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary,#f9f9f9)' }}>
              <td style={{ padding: '8px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-primary,#323338)' }}>{r.name}</span>
              </td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary,#323338)' }}>{r.count}</td>
              <td style={{ padding: '8px 8px', textAlign: 'right', color: '#9699a6' }}>
                {total ? Math.round(r.count / total * 100) : 0}%
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--border-color,#e6e9ef)', fontWeight: 700 }}>
            <td style={{ padding: '8px 8px', color: '#676879' }}>Total</td>
            <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-primary,#323338)' }}>{total}</td>
            <td style={{ padding: '8px 8px', textAlign: 'right', color: '#676879' }}>100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Text / Notes Widget ───────────────────────────────────────────────────────
function TextWidget({ widget, onUpdate, isManager }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(widget.config?.content || '');
  const save = () => { setEditing(false); onUpdate({ content: draft }); };
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {editing ? (
        <>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            style={{
              flex: 1, minHeight: 100, resize: 'vertical',
              border: '1.5px solid #0073ea', borderRadius: 6, padding: 10,
              fontSize: 13, fontFamily: 'inherit',
              background: 'var(--bg-primary,#fff)', color: 'var(--text-primary,#323338)',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setEditing(false); setDraft(widget.config?.content || ''); }}
              style={{ padding: '5px 12px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'transparent', color: '#676879' }}>Cancel</button>
            <button onClick={save}
              style={{ padding: '5px 14px', background: '#0073ea', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
          </div>
        </>
      ) : (
        <div
          onClick={() => isManager && setEditing(true)}
          style={{
            flex: 1, minHeight: 80, fontSize: 13, lineHeight: 1.6,
            color: draft ? 'var(--text-primary,#323338)' : '#c5c7d0',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            cursor: isManager ? 'text' : 'default',
            padding: 2,
          }}
        >
          {draft || (isManager ? 'Click to add notes…' : 'No content')}
        </div>
      )}
    </div>
  );
}

// ── Loading / empty state helpers ─────────────────────────────────────────────
function SkeletonPulse({ height = 100 }) {
  return (
    <div style={{
      height, borderRadius: 8,
      background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
      backgroundSize: '400% 100%',
      animation: 'shimmer 1.4s ease-in-out infinite',
    }} />
  );
}

function EmptyWidgetState({ text }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, textAlign: 'center' }}>
      <span style={{ fontSize: 28 }}>📭</span>
      <span style={{ fontSize: 12, color: '#9699a6' }}>{text}</span>
    </div>
  );
}

// ── Widget config form ────────────────────────────────────────────────────────
function WidgetConfigForm({ type, config, onChange, boards, boardDataCache, onFetchBoard }) {
  const [localBoardData, setLocalBoardData] = useState(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  const boardId = config.board_id;

  useEffect(() => {
    if (!boardId) { setLocalBoardData(null); return; }
    if (boardDataCache?.[boardId]) { setLocalBoardData(boardDataCache[boardId]); return; }
    setLoadingBoard(true);
    getBoard(boardId)
      .then(r => { setLocalBoardData(r.data); onFetchBoard?.(boardId, r.data); })
      .catch(() => {})
      .finally(() => setLoadingBoard(false));
  }, [boardId]);

  const selectStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13,
    border: '1.5px solid var(--border-color,#e6e9ef)',
    background: 'var(--bg-primary,#fff)', color: 'var(--text-primary,#323338)',
    outline: 'none',
  };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: '#676879', display: 'block', marginBottom: 4 };
  const field = (label, children) => (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );

  const colsByType = (types) => (localBoardData?.columns || []).filter(c => types.includes(c.type));
  const allCols = localBoardData?.columns || [];
  const groups = localBoardData?.groups || [];

  // Board selector (common to most types)
  const boardSelector = field('Board', (
    <select style={selectStyle} value={config.board_id || ''} onChange={e => onChange({ ...config, board_id: e.target.value ? parseInt(e.target.value) : null, column_id: null, group_ids: [] })}>
      <option value="">— Select a board —</option>
      {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  ));

  // Group filter (common)
  const groupFilter = groups.length > 0 && field('Filter by Groups (optional)', (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto', padding: '4px 0' }}>
      {groups.map(g => (
        <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={(config.group_ids || []).includes(String(g.id))}
            onChange={e => {
              const ids = config.group_ids || [];
              onChange({ ...config, group_ids: e.target.checked ? [...ids, String(g.id)] : ids.filter(x => x !== String(g.id)) });
            }}
            style={{ accentColor: '#0073ea' }}
          />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color || '#579bfc' }} />
            {g.name}
          </span>
        </label>
      ))}
    </div>
  ));

  if (type === 'kpi') return (
    <>
      {boardSelector}
      {loadingBoard && <div style={{ fontSize: 12, color: '#9699a6' }}>Loading board…</div>}
      {field('Metric', (
        <select style={selectStyle} value={config.metric || 'count'} onChange={e => onChange({ ...config, metric: e.target.value })}>
          <option value="count">Count of items</option>
          <option value="sum">Sum of column</option>
          <option value="avg">Average of column</option>
        </select>
      ))}
      {(config.metric === 'sum' || config.metric === 'avg') && field('Number Column', (
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value || null })}>
          <option value="">— Select column —</option>
          {colsByType(['number','formula']).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      ))}
      {field('Display Label', (
        <input style={{ ...selectStyle }} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} placeholder="e.g. Total Items" />
      ))}
      {field('Accent Color', (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['#0073ea','#00c875','#fdab3d','#e2445c','#a25ddc','#037f4c'].map(c => (
            <div key={c} onClick={() => onChange({ ...config, color: c })} style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', outline: config.color === c ? `3px solid ${c}` : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      ))}
      {groupFilter}
    </>
  );

  if (type === 'chart') return (
    <>
      {boardSelector}
      {loadingBoard && <div style={{ fontSize: 12, color: '#9699a6' }}>Loading board…</div>}
      {field('Chart Type', (
        <div style={{ display: 'flex', gap: 8 }}>
          {[['donut','Donut'],['pie','Pie'],['bar','Bar']].map(([v, l]) => (
            <button key={v} onClick={() => onChange({ ...config, chart_type: v })}
              style={{ flex: 1, padding: '7px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `2px solid ${config.chart_type === v ? '#0073ea' : 'var(--border-color,#e6e9ef)'}`, background: config.chart_type === v ? '#e8f0fe' : 'transparent', color: config.chart_type === v ? '#0073ea' : '#676879' }}>
              {l}
            </button>
          ))}
        </div>
      ))}
      {field('Column (Status / Dropdown)', (
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value || null })}>
          <option value="">— Select column —</option>
          {colsByType(['status','dropdown']).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      ))}
      {groupFilter}
    </>
  );

  if (type === 'battery') return (
    <>
      {boardSelector}
      {loadingBoard && <div style={{ fontSize: 12, color: '#9699a6' }}>Loading board…</div>}
      {field('Column (Status / Dropdown)', (
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value || null })}>
          <option value="">— Select column —</option>
          {colsByType(['status','dropdown']).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      ))}
      {groupFilter}
    </>
  );

  if (type === 'deadlines') return (
    <>
      {boardSelector}
      {loadingBoard && <div style={{ fontSize: 12, color: '#9699a6' }}>Loading board…</div>}
      {field('Date Column', (
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value || null })}>
          <option value="">— Select column —</option>
          {colsByType(['date']).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      ))}
      {field('Show items due within (days)', (
        <input type="number" min={0} max={365} style={selectStyle} value={config.days_ahead ?? 7} onChange={e => onChange({ ...config, days_ahead: parseInt(e.target.value) || 7 })} />
      ))}
      {groupFilter}
    </>
  );

  if (type === 'workload') return (
    <>
      {boardSelector}
      {loadingBoard && <div style={{ fontSize: 12, color: '#9699a6' }}>Loading board…</div>}
      {field('Person Column', (
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value || null })}>
          <option value="">— Select column —</option>
          {colsByType(['person']).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      ))}
      {groupFilter}
    </>
  );

  if (type === 'summary') return (
    <>
      {boardSelector}
      {loadingBoard && <div style={{ fontSize: 12, color: '#9699a6' }}>Loading board…</div>}
      {groupFilter}
    </>
  );

  if (type === 'text') return (
    <>
      {field('Widget Title', (
        <input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} placeholder="e.g. Sprint Notes" />
      ))}
      {field('Content', (
        <textarea style={{ ...selectStyle, minHeight: 100, resize: 'vertical' }} value={config.content || ''} onChange={e => onChange({ ...config, content: e.target.value })} placeholder="Enter notes or announcements…" />
      ))}
    </>
  );

  return <div style={{ fontSize: 13, color: '#9699a6' }}>No configuration needed.</div>;
}

// ── Add / Edit Widget Modal ────────────────────────────────────────────────────
function WidgetModal({ initial, boards, boardDataCache, onFetchBoard, onSave, onClose }) {
  const isEdit = !!initial;
  const [step, setStep] = useState(isEdit ? 'config' : 'type');
  const [selectedType, setSelectedType] = useState(initial?.type || null);
  const [config, setConfig] = useState(initial?.config || {});
  const [title, setTitle] = useState(initial?.title || '');
  const [width, setWidth] = useState(initial?.grid_w || 6);

  const def = WIDGET_DEFS.find(d => d.type === selectedType);

  const handleSave = () => {
    onSave({ type: selectedType, title: title || def?.label || '', config, grid_w: width });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 520, background: 'var(--card-bg,#fff)', borderRadius: 14, boxShadow: '0 16px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '90vh' }}>
        {/* Modal header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-color,#e6e9ef)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary,#323338)', margin: 0 }}>
              {isEdit ? 'Configure Widget' : step === 'type' ? 'Add Widget' : `Configure: ${def?.label}`}
            </h3>
            {!isEdit && step === 'config' && (
              <button onClick={() => setStep('type')} style={{ fontSize: 12, color: '#0073ea', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}>← Back</button>
            )}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#f0f0f0', color: '#676879', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {step === 'type' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {WIDGET_DEFS.map(def => (
                <div
                  key={def.type}
                  onClick={() => { setSelectedType(def.type); setWidth(def.defaultW); setConfig({}); setTitle(''); setStep('config'); }}
                  style={{
                    padding: '14px 16px', borderRadius: 10, border: '2px solid var(--border-color,#e6e9ef)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#0073ea'; e.currentTarget.style.background = '#f0f6ff'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color,#e6e9ef)'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 22 }}>{def.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary,#323338)' }}>{def.label}</span>
                  <span style={{ fontSize: 11, color: '#9699a6', lineHeight: 1.4 }}>{def.desc}</span>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Widget title + width */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#676879', display: 'block', marginBottom: 4 }}>Widget Title</label>
                <input
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13, border: '1.5px solid var(--border-color,#e6e9ef)', background: 'var(--bg-primary,#fff)', color: 'var(--text-primary,#323338)', outline: 'none', boxSizing: 'border-box' }}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={def?.label || 'Widget title'}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#676879', display: 'block', marginBottom: 6 }}>Width</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[[4,'Narrow (1/3)'],[6,'Half (1/2)'],[8,'Wide (2/3)'],[12,'Full']].map(([w, l]) => (
                    <button key={w} onClick={() => setWidth(w)}
                      style={{ flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `2px solid ${width === w ? '#0073ea' : 'var(--border-color,#e6e9ef)'}`, background: width === w ? '#e8f0fe' : 'transparent', color: width === w ? '#0073ea' : '#676879' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <WidgetConfigForm
                type={selectedType}
                config={config}
                onChange={setConfig}
                boards={boards}
                boardDataCache={boardDataCache}
                onFetchBoard={onFetchBoard}
              />
            </>
          )}
        </div>

        {/* Modal footer */}
        {step === 'config' && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color,#e6e9ef)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border-color,#e6e9ef)', background: 'transparent', color: '#676879', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
            <button onClick={handleSave} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#0073ea', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {isEdit ? 'Update Widget' : 'Add Widget'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main DashboardPage ────────────────────────────────────────────────────────
export default function DashboardPage({ dashboardId, dashboard, boards, onDashboardUpdate }) {
  const toast = useToast();
  const { isManager } = useAuth();

  const [widgets, setWidgets] = useState([]);
  const [loadingWidgets, setLoadingWidgets] = useState(true);
  const [boardDataCache, setBoardDataCache] = useState({});
  const [loadingBoardIds, setLoadingBoardIds] = useState(new Set());

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWidget, setEditingWidget] = useState(null);

  const [dashName, setDashName] = useState(dashboard?.name || '');
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef(null);

  // Load widgets on mount / dashboard change
  useEffect(() => {
    setLoadingWidgets(true);
    getDashboardWidgets(dashboardId)
      .then(data => { setWidgets(data); setLoadingWidgets(false); })
      .catch(() => { toast('Failed to load widgets', 'error'); setLoadingWidgets(false); });
  }, [dashboardId]);

  // Fetch board data for each widget that needs it
  useEffect(() => {
    const boardIds = [...new Set(widgets.map(w => w.config?.board_id).filter(Boolean).map(Number))];
    boardIds.forEach(boardId => {
      if (boardDataCache[boardId] || loadingBoardIds.has(boardId)) return;
      setLoadingBoardIds(prev => new Set([...prev, boardId]));
      getBoard(boardId)
        .then(res => {
          setBoardDataCache(prev => ({ ...prev, [boardId]: res.data }));
          setLoadingBoardIds(prev => { const s = new Set(prev); s.delete(boardId); return s; });
        })
        .catch(() => {
          setLoadingBoardIds(prev => { const s = new Set(prev); s.delete(boardId); return s; });
        });
    });
  }, [widgets]);

  // Keep local dashName in sync if dashboard prop changes
  useEffect(() => { setDashName(dashboard?.name || ''); }, [dashboard?.name]);

  const handleFetchBoard = useCallback((boardId, data) => {
    setBoardDataCache(prev => ({ ...prev, [boardId]: data }));
  }, []);

  const handleSaveName = async () => {
    const trimmed = dashName.trim();
    if (!trimmed || trimmed === dashboard?.name) { setEditingName(false); return; }
    try {
      const updated = await updateDashboard(dashboardId, { name: trimmed });
      onDashboardUpdate?.(updated);
      toast('Dashboard renamed', 'success');
    } catch { toast('Failed to rename', 'error'); setDashName(dashboard?.name || ''); }
    setEditingName(false);
  };

  const handleAddWidget = async (widgetData) => {
    try {
      const created = await createDashboardWidget(dashboardId, widgetData);
      setWidgets(prev => [...prev, created]);
      setShowAddModal(false);
      toast('Widget added!', 'success');
    } catch { toast('Failed to add widget', 'error'); }
  };

  const handleUpdateWidget = async (widgetData) => {
    try {
      const updated = await updateDashboardWidget(dashboardId, editingWidget.id, widgetData);
      setWidgets(prev => prev.map(w => w.id === updated.id ? updated : w));
      setEditingWidget(null);
      toast('Widget updated', 'success');
    } catch { toast('Failed to update widget', 'error'); }
  };

  const handleDeleteWidget = async (widgetId) => {
    if (!window.confirm('Remove this widget?')) return;
    try {
      await deleteDashboardWidget(dashboardId, widgetId);
      setWidgets(prev => prev.filter(w => w.id !== widgetId));
      toast('Widget removed', 'success');
    } catch { toast('Failed to remove widget', 'error'); }
  };

  const handleTextUpdate = async (widgetId, configUpdate) => {
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;
    try {
      const updated = await updateDashboardWidget(dashboardId, widgetId, {
        config: { ...widget.config, ...configUpdate },
      });
      setWidgets(prev => prev.map(w => w.id === updated.id ? updated : w));
    } catch { toast('Failed to save note', 'error'); }
  };

  const renderWidget = (widget) => {
    const bd = boardDataCache[widget.config?.board_id];
    const cfg = widget.config || {};
    switch (widget.type) {
      case 'kpi':       return <KpiWidget boardData={bd} config={cfg} />;
      case 'chart':     return <ChartWidget boardData={bd} config={cfg} />;
      case 'battery':   return <BatteryWidget boardData={bd} config={cfg} />;
      case 'deadlines': return <DeadlinesWidget boardData={bd} config={cfg} />;
      case 'workload':  return <WorkloadWidget boardData={bd} config={cfg} />;
      case 'summary':   return <SummaryWidget boardData={bd} config={cfg} />;
      case 'text':      return <TextWidget widget={widget} isManager={isManager} onUpdate={upd => handleTextUpdate(widget.id, upd)} />;
      default: return <EmptyWidgetState text={`Unknown widget type: ${widget.type}`} />;
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary,#f5f6f8)' }}>
      {/* ── Dashboard top bar ── */}
      <div style={{
        background: 'var(--bg-primary,#fff)',
        borderBottom: '1px solid var(--border-color,#e6e9ef)',
        padding: '0 24px', height: 52,
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontSize: 18 }}>📊</span>
        {editingName ? (
          <input
            ref={nameInputRef}
            autoFocus
            value={dashName}
            onChange={e => setDashName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setDashName(dashboard?.name || ''); setEditingName(false); } }}
            style={{ fontSize: 18, fontWeight: 700, border: '2px solid #0073ea', borderRadius: 6, padding: '2px 8px', outline: 'none', background: 'transparent', color: 'var(--text-primary,#323338)', minWidth: 200 }}
          />
        ) : (
          <h2
            onClick={() => isManager && setEditingName(true)}
            title={isManager ? 'Click to rename' : undefined}
            style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary,#323338)', margin: 0, cursor: isManager ? 'pointer' : 'default' }}
          >
            {dashName}
          </h2>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#9699a6' }}>
            {widgets.length} widget{widgets.length !== 1 ? 's' : ''}
          </span>
          {isManager && (
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                padding: '7px 16px', background: '#0073ea', color: '#fff',
                border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#0060c0'}
              onMouseLeave={e => e.currentTarget.style.background = '#0073ea'}
            >
              + Add Widget
            </button>
          )}
        </div>
      </div>

      {/* ── Widget grid ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loadingWidgets ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
            {[6,4,6,12,4,8].map((w, i) => (
              <div key={i} style={{ gridColumn: `span ${w}`, height: 200, borderRadius: 12, background: 'linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s ease-in-out infinite' }} />
            ))}
          </div>
        ) : widgets.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 56 }}>📊</span>
            <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary,#323338)', margin: 0 }}>Your dashboard is empty</h3>
            <p style={{ fontSize: 13, color: '#9699a6', margin: 0 }}>Add widgets to visualize your board data</p>
            {isManager && (
              <button
                onClick={() => setShowAddModal(true)}
                style={{ padding: '10px 24px', background: '#0073ea', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 8 }}
              >
                + Add Your First Widget
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
            {widgets.map(widget => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                isManager={isManager}
                onEdit={setEditingWidget}
                onDelete={handleDeleteWidget}
              >
                {renderWidget(widget)}
              </WidgetCard>
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showAddModal && (
        <WidgetModal
          boards={boards}
          boardDataCache={boardDataCache}
          onFetchBoard={handleFetchBoard}
          onSave={handleAddWidget}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {editingWidget && (
        <WidgetModal
          initial={editingWidget}
          boards={boards}
          boardDataCache={boardDataCache}
          onFetchBoard={handleFetchBoard}
          onSave={handleUpdateWidget}
          onClose={() => setEditingWidget(null)}
        />
      )}

      {/* Shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
