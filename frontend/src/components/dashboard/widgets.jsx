import React, { useMemo, useState, useEffect } from 'react';
import { getDashboardSnapshots } from '../../api';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LineChart, Line, LabelList,
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, ZAxis, Treemap, ComposedChart, FunnelChart, Funnel,
  RadialBarChart, RadialBar,
} from 'recharts';
import {
  CHART_COLORS, ACCENT_PALETTE, getFilteredItems, computeKpi, computeStatusDist,
  computeStackedByGroup, computeWorkload, computeDeadlines, computeGroupSummary,
  computeTrend, computeCumulative, computeKpiWithDelta, computeSparklineSeries,
  computeTopN, computePivot, computeHeatmap, computeCalendar, computeFunnel,
  computeBurndown, parseNumber, parsePersons, getColumn, getStatusOptions, truncate,
} from './helpers';
import {
  SkeletonPulse, EmptyWidgetState, Field, ButtonGroup, Toggle, ColorPicker,
  GroupFilter, BoardSelect, selectStyle,
} from './common';
import { toISODate } from '../../utils/dateFormat';

// Reusable axis builder for crowded x-axis charts
function rotatedXAxisProps(data) {
  const longestLabel = Math.max(...data.map(d => (d.name || '').length), 1);
  const needsRotation = data.length > 3 || longestLabel > 8;
  const xAxisHeight = needsRotation ? Math.min(110, 24 + Math.ceil(Math.min(longestLabel, 16) * 7)) : 30;
  return {
    needsRotation, xAxisHeight,
    chartHeight: needsRotation ? 220 + xAxisHeight : 240,
    axisProps: {
      interval: 0,
      angle: needsRotation ? -45 : 0,
      textAnchor: needsRotation ? 'end' : 'middle',
      height: xAxisHeight,
      tickMargin: needsRotation ? 8 : 4,
      tickFormatter: (s) => truncate(s, 16),
      tick: { fontSize: 10, fill: '#9699a6' },
      axisLine: false, tickLine: false,
    },
  };
}

// ───── Widget #1: Number / KPI ──────────────────────────────────────────────
const KpiWidget = {
  type: 'kpi', label: 'Numbers', icon: '🔢', category: 'KPI',
  desc: 'A key metric — count, sum, average, min, max, median', defaultW: 4,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={80} />;
    const value = computeKpi(boardData, config, filters);
    const color = config.color || '#9b72f5';
    const label = config.label || (config.metric === 'count' ? 'Total Items' : config.metric || 'Total');
    const formatted = typeof value === 'number' && Math.abs(value) >= 1000 ? value.toLocaleString() : String(value);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, padding: '8px 0' }}>
        <div style={{ fontSize: 48, fontWeight: 800, color, lineHeight: 1, letterSpacing: -2, fontVariantNumeric: 'tabular-nums' }}>{formatted}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #676879)', fontWeight: 500, textAlign: 'center' }}>{label}</div>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    const numCols = (board?.columns || []).filter(c => ['number','formula'].includes(c.type));
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v, column_id: null, group_ids: [] })} />
        <Field label="Metric">
          <select style={selectStyle} value={config.metric || 'count'} onChange={e => onChange({ ...config, metric: e.target.value })}>
            <option value="count">Count of items</option>
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="min">Minimum</option>
            <option value="max">Maximum</option>
            <option value="median">Median</option>
          </select>
        </Field>
        {config.metric && config.metric !== 'count' && (
          <Field label="Number Column">
            <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value || null })}>
              <option value="">— Select column —</option>
              {numCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Display Label"><input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} placeholder="Total Items" /></Field>
        <Field label="Accent Color"><ColorPicker value={config.color} onChange={c => onChange({ ...config, color: c })} palette={ACCENT_PALETTE} /></Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #2: KPI vs Previous Period ────────────────────────────────────
const KpiDeltaWidget = {
  type: 'kpi_delta', label: 'KPI vs Previous Period', icon: '📊', category: 'KPI',
  desc: 'Big number with % change vs the previous period', defaultW: 4,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={80} />;
    const { value, prev, curr, delta } = computeKpiWithDelta(boardData, config, filters);
    const up = delta >= 0;
    const color = config.color || '#9b72f5';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 6 }}>
        <div style={{ fontSize: 44, fontWeight: 800, color, lineHeight: 1 }}>{value.toLocaleString()}</div>
        <div style={{ fontSize: 12, color: '#676879' }}>{config.label || 'Total'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '4px 10px', borderRadius: 12, background: up ? '#e6f7ee' : '#ffeaee', color: up ? '#00875a' : '#e2445c', fontSize: 12, fontWeight: 700 }}>
          {up ? '▲' : '▼'} {Math.abs(delta)}% <span style={{ fontWeight: 400, color: '#676879' }}>vs prev {config.compare_days || 30}d</span>
        </div>
        <div style={{ fontSize: 10, color: '#9699a6' }}>{prev} → {curr}</div>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
        <Field label="Metric">
          <select style={selectStyle} value={config.metric || 'count'} onChange={e => onChange({ ...config, metric: e.target.value })}>
            <option value="count">Count of items</option>
            <option value="sum">Sum of column</option>
          </select>
        </Field>
        {config.metric === 'sum' && (
          <Field label="Column">
            <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
              <option value="">— Select —</option>
              {(board?.columns || []).filter(c => ['number','formula'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Compare Period (days)"><input type="number" min={1} style={selectStyle} value={config.compare_days || 30} onChange={e => onChange({ ...config, compare_days: parseInt(e.target.value) || 30 })} /></Field>
        <Field label="Label"><input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} /></Field>
        <Field label="Accent"><ColorPicker value={config.color} onChange={c => onChange({ ...config, color: c })} palette={ACCENT_PALETTE} /></Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #3: Sparkline KPI ─────────────────────────────────────────────
const SparklineKpiWidget = {
  type: 'sparkline', label: 'Sparkline KPI', icon: '📈', category: 'KPI',
  desc: 'Big number plus a tiny trend line over the last N days', defaultW: 4,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={100} />;
    const series = computeSparklineSeries(boardData, config, filters);
    const total = computeKpi(boardData, config, filters);
    const color = config.color || '#9b72f5';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
        <div style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1 }}>{total.toLocaleString()}</div>
        <div style={{ fontSize: 11, color: '#676879' }}>{config.label || `Last ${config.spark_days || 30} days`}</div>
        <div style={{ flex: 1, minHeight: 60 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={`spark-${config.color || 'blue'}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#spark-${config.color || 'blue'})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
        <Field label="Metric"><ButtonGroup value={config.metric || 'count'} onChange={v => onChange({ ...config, metric: v })} options={[['count','Count']]} /></Field>
        <Field label="Days"><input type="number" min={7} max={365} style={selectStyle} value={config.spark_days || 30} onChange={e => onChange({ ...config, spark_days: parseInt(e.target.value) || 30 })} /></Field>
        <Field label="Label"><input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} /></Field>
        <Field label="Color"><ColorPicker value={config.color} onChange={c => onChange({ ...config, color: c })} palette={ACCENT_PALETTE} /></Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #4: Multi-metric Card ─────────────────────────────────────────
const MultiMetricWidget = {
  type: 'multi_kpi', label: 'Multi-metric Card', icon: '🎴', category: 'KPI',
  desc: '3–4 KPIs displayed side-by-side in one card', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={80} />;
    const metrics = config.metrics || [];
    if (!metrics.length) return <EmptyWidgetState text="Add metrics in widget config" />;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(metrics.length, 4)}, 1fr)`, gap: 12, flex: 1, alignItems: 'center' }}>
        {metrics.map((m, i) => {
          const v = computeKpi(boardData, m, filters);
          const c = m.color || ACCENT_PALETTE[i % ACCENT_PALETTE.length];
          return (
            <div key={i} style={{ textAlign: 'center', padding: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: c, lineHeight: 1 }}>{Number.isFinite(v) ? v.toLocaleString() : v}</div>
              <div style={{ fontSize: 11, color: '#676879', marginTop: 4 }}>{m.label || m.metric}</div>
            </div>
          );
        })}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    const metrics = config.metrics || [];
    const updateM = (i, patch) => onChange({ ...config, metrics: metrics.map((m, idx) => idx === i ? { ...m, ...patch } : m) });
    const addM = () => onChange({ ...config, metrics: [...metrics, { metric: 'count', label: '', board_id: config.board_id }] });
    const delM = (i) => onChange({ ...config, metrics: metrics.filter((_, idx) => idx !== i) });
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v, metrics: metrics.map(m => ({ ...m, board_id: v })) })} />
        <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: '#676879' }}>Metrics ({metrics.length})</div>
        {metrics.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, padding: 10, border: '1px solid #e6e9ef', borderRadius: 6, background: '#fafbfc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#676879' }}>Metric {i + 1}</span>
              <button onClick={() => delM(i)} style={{ background: 'none', border: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 12 }}>Remove</button>
            </div>
            <input placeholder="Label (e.g. Open Tasks)" style={{ ...selectStyle, marginBottom: 6 }} value={m.label || ''} onChange={e => updateM(i, { label: e.target.value })} />
            <select style={{ ...selectStyle, marginBottom: 6 }} value={m.metric} onChange={e => updateM(i, { metric: e.target.value })}>
              <option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option>
            </select>
            {m.metric !== 'count' && (
              <select style={selectStyle} value={m.column_id || ''} onChange={e => updateM(i, { column_id: e.target.value })}>
                <option value="">— Column —</option>
                {(board?.columns || []).filter(c => ['number','formula'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </div>
        ))}
        {metrics.length < 4 && <button onClick={addM} style={{ padding: '6px 12px', background: '#9b72f5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>+ Add Metric</button>}
      </>
    );
  },
};

// ───── Widget #5: Goal Progress ─────────────────────────────────────────────
const GoalWidget = {
  type: 'goal', label: 'Goal Progress', icon: '🎯', category: 'KPI',
  desc: 'Progress bar toward a target value', defaultW: 4,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={120} />;
    const value = computeKpi(boardData, config, filters);
    const target = Number(config.target) || 100;
    const pct = target > 0 ? Math.min(100, Math.round((Number(value) / target) * 100)) : 0;
    const color = config.color || '#9b72f5';
    const reached = pct >= 100;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', flex: 1, padding: '8px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 11, color: '#9699a6', marginTop: 4 }}>of {target} {config.label || 'target'}</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: reached ? '#00c875' : color }}>{pct}%{reached ? ' ✓' : ''}</div>
        </div>
        <div style={{ height: 12, borderRadius: 6, background: '#f0f0f0', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: reached ? 'linear-gradient(90deg,#00c875,#00a85a)' : `linear-gradient(90deg,${color},${color}cc)`, transition: 'width 0.5s ease' }} />
        </div>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
        <Field label="Metric">
          <select style={selectStyle} value={config.metric || 'count'} onChange={e => onChange({ ...config, metric: e.target.value })}>
            <option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option>
          </select>
        </Field>
        {config.metric !== 'count' && (
          <Field label="Column">
            <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
              <option value="">— Column —</option>
              {(board?.columns || []).filter(c => ['number','formula'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Target Value"><input type="number" style={selectStyle} value={config.target ?? 100} onChange={e => onChange({ ...config, target: parseFloat(e.target.value) || 0 })} /></Field>
        <Field label="Target Label"><input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} placeholder="completed tasks" /></Field>
        <Field label="Accent"><ColorPicker value={config.color} onChange={c => onChange({ ...config, color: c })} palette={ACCENT_PALETTE} /></Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #6: Universal Chart (Pie/Bar/HBar/Line/Donut) ────────────────
const ChartWidget = {
  type: 'chart', label: 'Chart', icon: '📊', category: 'Charts',
  desc: 'Pie, donut, bar, horizontal bar, or line chart', defaultW: 6,
  View({ boardData, config, filters, onDrill }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const data = computeStatusDist(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="No data — pick a status / dropdown column" />;
    const t = config.chart_type || 'donut';
    const showLabels = config.show_labels !== false;
    const { axisProps, chartHeight } = rotatedXAxisProps(data);

    // Drill-through: clicking a segment opens the underlying items.
    const drillTo = (label) => {
      if (!onDrill || !config.column_id) return;
      const target = label === 'Empty' ? '' : label;
      const matched = getFilteredItems(boardData, config.group_ids, filters)
        .filter(it => String(it.values?.[config.column_id] ?? '') === String(target));
      const colTitle = (boardData.columns || []).find(c => String(c.id) === String(config.column_id))?.title || 'Items';
      onDrill({ title: `${colTitle}: ${label || '(empty)'}`, items: matched, columns: boardData.columns, boardId: config.board_id });
    };
    const barClick = (d) => drillTo(d?.name ?? d?.payload?.name);

    if (t === 'bar') return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <BarChart data={data} margin={{ top: 24, right: 16, left: -10, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="name" {...axisProps} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Bar dataKey="value" radius={[4,4,0,0]} onClick={barClick} cursor={onDrill ? 'pointer' : 'default'}>
            {showLabels && <LabelList dataKey="value" position="top" style={{ fontSize: 11, fontWeight: 700, fill: '#323338' }} />}
            {data.map((e, i) => <Cell key={i} fill={e.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );

    if (t === 'hbar') {
      return (
        <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(180, data.length * 32 + 24)}>
          <BarChart data={data} layout="vertical" margin={{ top: 6, right: 36, left: 8, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={120} interval={0} tick={{ fontSize: 11, fill: '#676879' }} tickFormatter={s => truncate(s, 16)} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
            <Bar dataKey="value" radius={[0,4,4,0]} onClick={barClick} cursor={onDrill ? 'pointer' : 'default'}>
              {showLabels && <LabelList dataKey="value" position="right" style={{ fontSize: 11, fontWeight: 700, fill: '#323338' }} />}
              {data.map((e, i) => <Cell key={i} fill={e.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (t === 'line') return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <LineChart data={data} margin={{ top: 24, right: 16, left: -10, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="name" {...axisProps} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Line type="monotone" dataKey="value" stroke="#9b72f5" strokeWidth={2.5} dot={{ r: 4, fill: '#9b72f5' }}>
            {showLabels && <LabelList dataKey="value" position="top" style={{ fontSize: 11, fontWeight: 700, fill: '#323338' }} />}
          </Line>
        </LineChart>
      </ResponsiveContainer>
    );

    const inner = t === 'donut' ? '52%' : '0%';
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="78%" innerRadius={inner} paddingAngle={t === 'donut' ? 2 : 0} label={showLabels ? ({ value }) => value : false} labelLine={false} onClick={barClick} cursor={onDrill ? 'pointer' : 'default'}>
            {data.map((e, i) => <Cell key={i} fill={e.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#676879' }}>{v}</span>} />
        </PieChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v, column_id: null, group_ids: [] })} />
        <Field label="Chart Type">
          <ButtonGroup value={config.chart_type || 'donut'} onChange={v => onChange({ ...config, chart_type: v })}
            options={[['donut','Donut'],['pie','Pie'],['bar','Bar'],['hbar','H-Bar'],['line','Line']]} />
        </Field>
        <Field label="Column (Status / Dropdown)">
          <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value || null })}>
            <option value="">— Select —</option>
            {(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        <Field label="Display"><Toggle checked={config.show_labels !== false} onChange={v => onChange({ ...config, show_labels: v })} label="Show value labels" /></Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #7: Stacked Bar (status × group) ──────────────────────────────
const StackedBarWidget = {
  type: 'stacked_bar', label: 'Stacked Bar', icon: '🟦', category: 'Charts',
  desc: 'Status distribution stacked per group', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const { rows, statuses } = computeStackedByGroup(boardData, config, filters);
    if (!rows.length || !statuses.length) return <EmptyWidgetState text="Pick a status column" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <BarChart data={rows} margin={{ top: 12, right: 12, left: -10, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="group" tick={{ fontSize: 10, fill: '#9699a6' }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={60} tickFormatter={s => truncate(s, 14)} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#676879' }}>{v}</span>} />
          {statuses.map((s, i) => (
            <Bar key={s.name} dataKey={s.name} stackId="a" fill={s.color || CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
        <Field label="Status Column">
          <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
            <option value="">— Select —</option>
            {(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #8: Battery ───────────────────────────────────────────────────
const BatteryWidget = {
  type: 'battery', label: 'Battery', icon: '🔋', category: 'Charts',
  desc: 'Stacked progress bar showing status distribution', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={120} />;
    const data = computeStatusDist(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Pick a status column" />;
    const total = data.reduce((s, d) => s + d.value, 0);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', background: '#f0f0f0' }}>
          {data.map((d, i) => (
            <div key={i} title={`${d.name}: ${d.value} (${total ? Math.round(d.value/total*100) : 0}%)`}
              style={{ width: `${total ? (d.value / total * 100) : 0}%`, background: d.color || CHART_COLORS[i % CHART_COLORS.length], transition: 'width 0.4s' }} />
          ))}
        </div>
        {data.map((d, i) => {
          const pct = total ? Math.round(d.value / total * 100) : 0;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color || CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#323338', flex: 1 }}>{d.name}</span>
              <span style={{ fontSize: 11, color: '#9699a6', fontWeight: 600 }}>{pct}%</span>
              <span style={{ fontSize: 11, color: '#9699a6', minWidth: 24, textAlign: 'right' }}>{d.value}</span>
            </div>
          );
        })}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
        <Field label="Status Column">
          <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
            <option value="">— Select —</option>
            {(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #9: Trend Over Time (area) ────────────────────────────────────
const TrendWidget = {
  type: 'trend', label: 'Trend Over Time', icon: '📈', category: 'Charts',
  desc: 'Items created per day / week / month / quarter / year', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const data = computeTrend(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="No items with creation dates yet" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <AreaChart data={data} margin={{ top: 22, right: 16, left: -10, bottom: 6 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9b72f5" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#9b72f5" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Area type="monotone" dataKey="value" stroke="#9b72f5" strokeWidth={2.5} fill="url(#trendFill)">
            {config.show_labels !== false && <LabelList dataKey="value" position="top" style={{ fontSize: 10, fontWeight: 700, fill: '#323338' }} />}
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
        <Field label="Group by"><ButtonGroup value={config.granularity || 'week'} onChange={v => onChange({ ...config, granularity: v })} options={[['day','Day'],['week','Week'],['month','Month'],['quarter','Q'],['year','Yr']]} /></Field>
        <Field label="Display"><Toggle checked={config.show_labels !== false} onChange={v => onChange({ ...config, show_labels: v })} label="Show values" /></Field>
        <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
      </>
    );
  },
};

// ───── Widget #10: Cumulative Trend ─────────────────────────────────────────
const CumulativeWidget = {
  type: 'cumulative', label: 'Cumulative Trend', icon: '📊', category: 'Charts',
  desc: 'Running total of items created over time', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const data = computeCumulative(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="No items with dates" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <ComposedChart data={data} margin={{ top: 12, right: 16, left: -10, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Bar dataKey="value" radius={[3,3,0,0]}>
            {data.map((e, i) => (
              <Cell key={i} fill={config.multicolor ? CHART_COLORS[i % CHART_COLORS.length] : '#9b72f588'} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="cumulative" stroke="#e2445c" strokeWidth={3} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Group by"><ButtonGroup value={config.granularity || 'week'} onChange={v => onChange({ ...config, granularity: v })} options={[['day','Day'],['week','Week'],['month','Month']]} /></Field>
      <Field label="Display"><Toggle checked={!!config.multicolor} onChange={v => onChange({ ...config, multicolor: v })} label="Multicolor bars" /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #11: Funnel ───────────────────────────────────────────────────
const FunnelWidget = {
  type: 'funnel', label: 'Funnel', icon: '🪜', category: 'Charts',
  desc: 'Pipeline stages — bar or trapezoid funnel', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const data = computeFunnel(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Add stages in widget config" />;
    const mode = config.funnel_mode || 'bar';
    const max = Math.max(...data.map(d => d.value), 1);
    const first = data[0]?.value || 0;

    // Trapezoid funnel — uses Recharts FunnelChart for the classic shape
    if (mode === 'trapezoid') {
      const colored = data.map((d, i) => ({ ...d, fill: CHART_COLORS[i % CHART_COLORS.length] }));
      return (
        <ResponsiveContainer width="100%" height="100%" minHeight={220}>
          <FunnelChart>
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
            <Funnel dataKey="value" data={colored} isAnimationActive lastShapeType="triangle">
              <LabelList position="right" fill="#323338" stroke="none" dataKey="name" style={{ fontSize: 11, fontWeight: 600 }} />
              <LabelList position="center" fill="#fff" stroke="none" dataKey="value" style={{ fontSize: 13, fontWeight: 800 }} />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      );
    }

    // Bar funnel (default)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' }}>
        {data.map((s, i) => {
          const pct = (s.value / max) * 100;
          const conv = i === 0 ? null : (first ? Math.round((s.value / first) * 100) : 0);
          const c = CHART_COLORS[i % CHART_COLORS.length];
          return (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 110, fontSize: 12, color: '#323338', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <div style={{ flex: 1, height: 28, background: '#f4f5f7', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${c}, ${c}cc)`, transition: 'width 0.4s' }} />
                <span style={{ position: 'absolute', right: 8, top: 5, fontSize: 12, fontWeight: 700, color: pct > 50 ? '#fff' : '#323338' }}>{s.value}</span>
              </div>
              <span style={{ width: 40, fontSize: 10, color: '#9699a6', textAlign: 'right' }}>{conv !== null ? `${conv}%` : ''}</span>
            </div>
          );
        })}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    const col = (board?.columns || []).find(c => String(c.id) === String(config.column_id));
    const opts = col?.settings?.options?.map(o => o.label) || [];
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v, column_id: null, stages: [] })} />
      <Field label="Funnel Style">
        <ButtonGroup value={config.funnel_mode || 'bar'} onChange={v => onChange({ ...config, funnel_mode: v })}
          options={[['bar','Bar Funnel'],['trapezoid','Trapezoid']]} />
      </Field>
      <Field label="Status Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value, stages: [] })}>
          <option value="">— Select —</option>
          {(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      {opts.length > 0 && (
        <Field label="Pick stages in funnel order">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(config.stages || []).map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <span style={{ minWidth: 18, fontSize: 11, color: '#9699a6' }}>{i+1}.</span>
                <span style={{ flex: 1, fontSize: 12 }}>{s}</span>
                <button onClick={() => onChange({ ...config, stages: config.stages.filter((_, idx) => idx !== i) })} style={{ background: 'none', border: 'none', color: '#e2445c', cursor: 'pointer' }}>×</button>
              </div>
            ))}
            <select style={selectStyle} value="" onChange={e => { if (e.target.value) onChange({ ...config, stages: [...(config.stages || []), e.target.value] }); }}>
              <option value="">+ add stage…</option>
              {opts.filter(o => !(config.stages || []).includes(o)).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </Field>
      )}
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #12: Radar (multi-dimension comparison) ───────────────────────
const RadarWidget = {
  type: 'radar', label: 'Radar / Spider', icon: '🕷', category: 'Charts',
  desc: 'Compare values across multiple categories at once', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const data = computeStatusDist(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Pick a status column" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <RadarChart data={data} outerRadius="78%">
          <PolarGrid stroke="#e6e9ef" />
          <PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: '#676879' }} />
          <PolarRadiusAxis tick={{ fontSize: 10, fill: '#9699a6' }} />
          <Radar dataKey="value" stroke="#9b72f5" fill="#9b72f5" fillOpacity={0.4} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Select —</option>
          {(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #13: Scatter / Bubble ─────────────────────────────────────────
const ScatterWidget = {
  type: 'scatter', label: 'Scatter / Bubble', icon: '🫧', category: 'Charts',
  desc: 'Plot two number columns; bubble size from a third', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const items = getFilteredItems(boardData, config.group_ids, filters);
    const { x_col, y_col, z_col } = config;
    if (!x_col || !y_col) return <EmptyWidgetState text="Pick X and Y number columns" />;
    const data = items.map(i => ({
      name: i.name,
      x: parseNumber(i.values?.[x_col]),
      y: parseNumber(i.values?.[y_col]),
      z: z_col ? parseNumber(i.values?.[z_col]) : 60,
    })).filter(d => !isNaN(d.x) && !isNaN(d.y));
    if (!data.length) return <EmptyWidgetState text="No numeric data found" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <ScatterChart margin={{ top: 12, right: 12, left: -10, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" />
          <XAxis type="number" dataKey="x" name="X" tick={{ fontSize: 11, fill: '#9699a6' }} />
          <YAxis type="number" dataKey="y" name="Y" tick={{ fontSize: 11, fill: '#9699a6' }} />
          <ZAxis type="number" dataKey="z" range={[60, 400]} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Scatter data={data} fill="#9b72f5" />
        </ScatterChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    const numCols = (board?.columns || []).filter(c => ['number','formula'].includes(c.type));
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      {['x_col','y_col','z_col'].map((k, i) => (
        <Field key={k} label={['X axis','Y axis','Bubble size (optional)'][i]}>
          <select style={selectStyle} value={config[k] || ''} onChange={e => onChange({ ...config, [k]: e.target.value })}>
            <option value="">— Column —</option>
            {numCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
      ))}
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #14: Treemap ──────────────────────────────────────────────────
const TreemapWidget = {
  type: 'treemap', label: 'Treemap', icon: '🟧', category: 'Charts',
  desc: 'Proportional rectangles — at-a-glance share by category', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const data = computeStatusDist(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Pick a status column" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <Treemap data={data} dataKey="value" stroke="#fff" fill="#9b72f5" content={<TreemapNode />} />
      </ResponsiveContainer>
    );
  },
  ConfigForm: ChartWidget.ConfigForm,
};
function TreemapNode(props) {
  const { x, y, width, height, name, value, index } = props;
  const c = CHART_COLORS[(index || 0) % CHART_COLORS.length];
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} style={{ fill: c, stroke: '#fff', strokeWidth: 2 }} />
      {width > 60 && height > 30 && (
        <>
          <text x={x + width / 2} y={y + height / 2 - 4} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={700}>{name}</text>
          <text x={x + width / 2} y={y + height / 2 + 12} textAnchor="middle" fill="#fff" fontSize={11} opacity={0.85}>{value}</text>
        </>
      )}
    </g>
  );
}

// ───── Widget #15: Heatmap (day-of-week × hour) ─────────────────────────────
const HeatmapWidget = {
  type: 'heatmap', label: 'Heatmap', icon: '🔥', category: 'Charts',
  desc: 'Activity intensity by day-of-week × hour', defaultW: 8,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const grid = computeHeatmap(boardData, config, filters);
    const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const max = Math.max(0, ...Object.values(grid));
    if (max === 0) return <EmptyWidgetState text="No timestamped items yet" />;
    const cell = (x, y) => {
      const v = grid[`${x}-${y}`] || 0;
      const ratio = v / max;
      const bg = ratio === 0 ? '#f3f4f6' : `rgba(0,115,234,${0.15 + ratio * 0.85})`;
      return <div key={`${x}-${y}`} title={`${dows[x]} ${y}:00 — ${v}`} style={{ height: 16, background: bg, borderRadius: 2 }} />;
    };
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '36px repeat(24, 1fr)', gap: 2, fontSize: 9 }}>
        <div />
        {hours.map(h => <div key={h} style={{ textAlign: 'center', color: '#9699a6' }}>{h % 3 === 0 ? h : ''}</div>)}
        {dows.map((d, x) => (
          <React.Fragment key={d}>
            <div style={{ fontSize: 10, color: '#676879', textAlign: 'right', paddingRight: 4 }}>{d}</div>
            {hours.map(y => cell(x, y))}
          </React.Fragment>
        ))}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #16: Gauge / Speedometer ──────────────────────────────────────
const GaugeWidget = {
  type: 'gauge', label: 'Gauge', icon: '🎚', category: 'Charts',
  desc: 'Dial showing current value vs target', defaultW: 4,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={140} />;
    const value = computeKpi(boardData, config, filters);
    const target = Number(config.target) || 100;
    const pct = Math.min(100, Math.max(0, (Number(value) / target) * 100));
    const data = [{ name: 'val', value: pct, fill: pct >= 100 ? '#00c875' : (config.color || '#9b72f5') }];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
        {/* Relative wrapper + absolutely-centered % so the value sits in the dial
            centre at any widget height (was a fragile negative margin that
            overlapped the arc when the card was short). */}
        <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 160 }}>
          <ResponsiveContainer width="100%" height="100%" minHeight={160}>
            <RadialBarChart innerRadius="65%" outerRadius="95%" data={data} startAngle={210} endAngle={-30}>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#f0f0f0' }} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div style={{ position: 'absolute', top: '60%', left: 0, right: 0, transform: 'translateY(-50%)', textAlign: 'center', fontSize: 24, fontWeight: 800, color: config.color || '#9b72f5', pointerEvents: 'none' }}>{Math.round(pct)}%</div>
        </div>
        <div style={{ fontSize: 11, color: '#676879', marginTop: 6 }}>{value} / {target} {config.label || ''}</div>
      </div>
    );
  },
  ConfigForm: GoalWidget.ConfigForm,
};

// ───── Widget #17: Radial / Sunburst ────────────────────────────────────────
const RadialWidget = {
  type: 'radial', label: 'Radial Bars', icon: '🌀', category: 'Charts',
  desc: 'Concentric arcs — beautiful for status share', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const data = computeStatusDist(boardData, config, filters).map((d, i) => ({ ...d, fill: d.color || CHART_COLORS[i % CHART_COLORS.length] }));
    if (!data.length) return <EmptyWidgetState text="Pick a status column" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <RadialBarChart innerRadius="20%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
          <RadialBar minAngle={2} dataKey="value" background clockWise cornerRadius={6} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#676879' }}>{v}</span>} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
        </RadialBarChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm: ChartWidget.ConfigForm,
};

// ───── Widget #18: Combo Chart (bar + line) ─────────────────────────────────
const ComboChartWidget = {
  type: 'combo', label: 'Combo Bar + Line', icon: '📉', category: 'Charts',
  desc: 'Bars and overlay line — count + cumulative', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const data = computeCumulative(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="No items with dates" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <ComposedChart data={data} margin={{ top: 12, right: 16, left: -10, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#e2445c' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#676879' }}>{v}</span>} />
          <Bar yAxisId="l" dataKey="value" fill="#9b72f5" radius={[3,3,0,0]} name="New" />
          <Line yAxisId="r" type="monotone" dataKey="cumulative" stroke="#e2445c" strokeWidth={3} dot={false} name="Total" />
        </ComposedChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm: CumulativeWidget.ConfigForm,
};

// ───── Widget #19: Summary Table ────────────────────────────────────────────
const SummaryWidget = {
  type: 'summary', label: 'Summary Table', icon: '📋', category: 'Tables',
  desc: 'Counts per group with % share', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const groups = boardData.groups || [];
    const useGroups = config.group_ids?.length ? groups.filter(g => config.group_ids.includes(String(g.id))) : groups;
    const rows = useGroups.map(g => ({ id: g.id, name: g.name, color: g.color || '#579bfc', count: (g.items || []).length }));
    if (!rows.length) return <EmptyWidgetState text="No groups" />;
    const total = rows.reduce((s, r) => s + r.count, 0);
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e6e9ef' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#9699a6', fontWeight: 700 }}>GROUP</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: '#9699a6', fontWeight: 700 }}>ITEMS</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: '#9699a6', fontWeight: 700 }}>SHARE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 ? '#f9f9f9' : 'transparent' }}>
                <td style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color }} />{r.name}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{r.count}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#9699a6' }}>{total ? Math.round(r.count / total * 100) : 0}%</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid #e6e9ef', fontWeight: 700 }}>
              <td style={{ padding: '8px' }}>Total</td>
              <td style={{ padding: '8px', textAlign: 'right' }}>{total}</td>
              <td style={{ padding: '8px', textAlign: 'right', color: '#676879' }}>100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #20: Top N Items ──────────────────────────────────────────────
const TopNWidget = {
  type: 'top_n', label: 'Top N Items', icon: '🏅', category: 'Tables',
  desc: 'Top items sorted by any number column', defaultW: 6,
  View({ boardData, config, filters, onOpenItem }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const rows = computeTopN(boardData, config, filters);
    if (!rows.length) return <EmptyWidgetState text="No data — pick a sort column" />;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r, i) => (
          <div key={r.id} onClick={() => onOpenItem?.(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: i === 0 ? '#fff8e1' : '#f5f6f8', cursor: onOpenItem ? 'pointer' : 'default' }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? ['#fdab3d','#9699a6','#a0522d'][i] : '#e6e9ef', color: i < 3 ? '#fff' : '#676879', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#9b72f5' }}>{r.value}</span>
          </div>
        ))}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    const numCols = (board?.columns || []).filter(c => ['number','formula'].includes(c.type));
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Sort by Column">
        <select style={selectStyle} value={config.sort_column || ''} onChange={e => onChange({ ...config, sort_column: e.target.value })}>
          <option value="">— Column —</option>
          {numCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Direction"><ButtonGroup value={config.direction || 'desc'} onChange={v => onChange({ ...config, direction: v })} options={[['desc','Highest'],['asc','Lowest']]} /></Field>
      <Field label="How many"><input type="number" min={1} max={50} style={selectStyle} value={config.n || 5} onChange={e => onChange({ ...config, n: parseInt(e.target.value) || 5 })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #21: Pivot Table ──────────────────────────────────────────────
const PivotWidget = {
  type: 'pivot', label: 'Pivot Table', icon: '🔢', category: 'Tables',
  desc: 'Cross-tab: groups × statuses (or any two dimensions)', defaultW: 8,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const { rows, cols, cells, colOpts } = computePivot(boardData, config, filters);
    if (!rows.length || !cols.length) return <EmptyWidgetState text="Pick row + column dimensions" />;
    const colMap = {};
    (colOpts || []).forEach(o => { colMap[o.label] = o.color; });
    return (
      <div style={{ overflow: 'auto', maxHeight: 380 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e6e9ef', background: '#fafbfc' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: '#9699a6' }}>Row</th>
              {cols.map(c => (
                <th key={c} style={{ padding: '6px 8px', textAlign: 'right', color: '#9699a6' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {colMap[c] && <span style={{ width: 8, height: 8, borderRadius: 2, background: colMap[c] }} />}
                    {c}
                  </span>
                </th>
              ))}
              <th style={{ padding: '6px 8px', textAlign: 'right', color: '#323338', fontWeight: 700 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const total = cols.reduce((s, c) => s + (cells[r + '||' + c] || 0), 0);
              return (
                <tr key={r} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r}</td>
                  {cols.map(c => {
                    const v = cells[r + '||' + c] || 0;
                    const max = Math.max(...rows.flatMap(rr => cols.map(cc => cells[rr + '||' + cc] || 0)), 1);
                    const intensity = v / max;
                    return <td key={c} style={{ padding: '7px 8px', textAlign: 'right', background: v ? `rgba(0,115,234,${0.05 + intensity * 0.4})` : 'transparent' }}>{v || ''}</td>;
                  })}
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Rows"><ButtonGroup value={config.row_field || 'group'} onChange={v => onChange({ ...config, row_field: v })} options={[['group','By Group']]} /></Field>
      <Field label="Columns (Status)">
        <select style={selectStyle} value={config.col_column_id || ''} onChange={e => onChange({ ...config, col_column_id: e.target.value })}>
          <option value="">— Select —</option>
          {(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Metric"><ButtonGroup value={config.metric || 'count'} onChange={v => onChange({ ...config, metric: v })} options={[['count','Count'],['sum','Sum'],['avg','Avg']]} /></Field>
      {config.metric !== 'count' && (
        <Field label="Value Column">
          <select style={selectStyle} value={config.value_column_id || ''} onChange={e => onChange({ ...config, value_column_id: e.target.value })}>
            <option value="">— Column —</option>
            {(board?.columns || []).filter(c => ['number','formula'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
      )}
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #22: Items List Preview ───────────────────────────────────────
const ItemsListWidget = {
  type: 'items_list', label: 'Items List', icon: '📃', category: 'Tables',
  desc: 'Preview the first N items with optional column display', defaultW: 6,
  View({ boardData, config, filters, onOpenItem }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const items = getFilteredItems(boardData, config.group_ids, filters).slice(0, Number(config.limit) || 10);
    if (!items.length) return <EmptyWidgetState text="No items match" />;
    const showCols = (config.display_columns || []).map(id => boardData.columns?.find(c => String(c.id) === String(id))).filter(Boolean);
    return (
      <div style={{ overflow: 'auto', maxHeight: 360 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #e6e9ef' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', color: '#9699a6' }}>Name</th>
            {showCols.map(c => <th key={c.id} style={{ padding: '6px 8px', textAlign: 'left', color: '#9699a6' }}>{c.title}</th>)}
          </tr></thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} onClick={() => onOpenItem?.(it.id)} style={{ borderBottom: '1px solid #f5f5f5', cursor: onOpenItem ? 'pointer' : 'default' }}>
                <td style={{ padding: '7px 8px', fontWeight: 500 }}>{it.name}</td>
                {showCols.map(c => <td key={c.id} style={{ padding: '7px 8px', color: '#676879' }}>{String(it.values?.[c.id] || '').slice(0, 30)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v, display_columns: [] })} />
      <Field label="Show columns">
        <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(board?.columns || []).slice(0, 30).map(c => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={(config.display_columns || []).includes(String(c.id))} onChange={e => {
                const arr = config.display_columns || [];
                onChange({ ...config, display_columns: e.target.checked ? [...arr, String(c.id)] : arr.filter(x => x !== String(c.id)) });
              }} style={{ accentColor: '#9b72f5' }} />
              {c.title}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Limit"><input type="number" min={1} max={100} style={selectStyle} value={config.limit || 10} onChange={e => onChange({ ...config, limit: parseInt(e.target.value) || 10 })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #23: Recent Activity Feed ─────────────────────────────────────
const ActivityWidget = {
  type: 'activity', label: 'Recent Activity', icon: '📰', category: 'Tables',
  desc: 'Latest items created on this board', defaultW: 6,
  View({ boardData, config, filters, onOpenItem }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const items = getFilteredItems(boardData, config.group_ids, filters)
      .filter(i => i.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, Number(config.limit) || 10);
    if (!items.length) return <EmptyWidgetState text="No recent items" />;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(it => {
          const d = new Date(it.created_at);
          const ago = humanAgo(d);
          return (
            <div key={it.id} onClick={() => onOpenItem?.(it.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, background: '#f5f6f8', cursor: onOpenItem ? 'pointer' : 'default' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: it._groupColor || '#9b72f5' }} />
              <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
              <span style={{ fontSize: 11, color: '#9699a6' }}>{ago}</span>
            </div>
          );
        })}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Limit"><input type="number" min={1} max={50} style={selectStyle} value={config.limit || 10} onChange={e => onChange({ ...config, limit: parseInt(e.target.value) || 10 })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};
function humanAgo(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  if (s < 604800) return `${Math.floor(s/86400)}d ago`;
  return toISODate(d);
}

// ───── Widget #24: Upcoming Deadlines ───────────────────────────────────────
const DeadlinesWidget = {
  type: 'deadlines', label: 'Upcoming Deadlines', icon: '📅', category: 'Time',
  desc: 'Items with approaching or overdue dates', defaultW: 6,
  View({ boardData, config, filters, onOpenItem }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const items = computeDeadlines(boardData, config, filters);
    if (!items.length) return <EmptyWidgetState text="No upcoming deadlines" />;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(it => {
          const overdue = it.diffDays < 0;
          const today = it.diffDays === 0;
          const c = overdue ? '#e2445c' : today ? '#fdab3d' : '#00c875';
          const lbl = overdue ? `${Math.abs(it.diffDays)}d overdue` : today ? 'Today' : `In ${it.diffDays}d`;
          return (
            <div key={it.id} onClick={() => onOpenItem?.(it.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, background: '#f5f6f8', cursor: onOpenItem ? 'pointer' : 'default' }}>
              <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: c, background: c + '20', padding: '2px 8px', borderRadius: 10 }}>{lbl}</span>
            </div>
          );
        })}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Date Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Column —</option>
          {(board?.columns || []).filter(c => c.type === 'date').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Days ahead"><input type="number" min={0} max={365} style={selectStyle} value={config.days_ahead ?? 7} onChange={e => onChange({ ...config, days_ahead: parseInt(e.target.value) || 7 })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #25: Calendar (month view) ────────────────────────────────────
const CalendarWidget = {
  type: 'calendar', label: 'Calendar', icon: '🗓', category: 'Time',
  desc: 'Mini calendar — items on each day for selected month', defaultW: 6,
  View({ boardData, config, filters, onOpenItem }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const map = computeCalendar(boardData, config, filters);
    const today = new Date();
    const yr = config.year || today.getFullYear();
    const mo = config.month != null ? config.month : today.getMonth();
    const first = new Date(yr, mo, 1);
    const last = new Date(yr, mo + 1, 0);
    const startDow = first.getDay();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) cells.push(d);
    // Calendar header shown as YYYY-MM (ISO) — single date format across the app.
    const monthName = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
    return (
      <div>
        <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{monthName}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, fontSize: 10 }}>
          {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} style={{ textAlign: 'center', color: '#9699a6', fontWeight: 600 }}>{d}</div>)}
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const key = `${yr}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const items = map[key] || [];
            const isToday = today.getFullYear() === yr && today.getMonth() === mo && today.getDate() === day;
            return (
              <div key={i} title={items.map(i => i.name).join('\n')} style={{ aspectRatio: '1/1', borderRadius: 6, background: items.length ? `rgba(0,115,234,${0.15 + Math.min(items.length, 5) * 0.15})` : '#f5f6f8', border: isToday ? '2px solid #9b72f5' : '1px solid transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: items.length ? 'pointer' : 'default' }} onClick={() => items[0] && onOpenItem?.(items[0].id)}>
                <span style={{ fontSize: 11, color: '#323338' }}>{day}</span>
                {items.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: '#9b72f5' }}>{items.length}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Date Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Column —</option>
          {(board?.columns || []).filter(c => c.type === 'date').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #26: Timeline / Mini-Gantt ────────────────────────────────────
const TimelineWidget = {
  type: 'timeline', label: 'Timeline', icon: '📏', category: 'Time',
  desc: 'Horizontal bars between two date columns — mini Gantt', defaultW: 8,
  View({ boardData, config, filters, onOpenItem }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const { date_from, date_to } = config;
    if (!date_from || !date_to) return <EmptyWidgetState text="Pick start and end date columns" />;
    const items = getFilteredItems(boardData, config.group_ids, filters)
      .map(i => {
        const a = new Date(i.values?.[date_from]); const b = new Date(i.values?.[date_to]);
        return isNaN(a.getTime()) || isNaN(b.getTime()) ? null : { ...i, _from: a, _to: b };
      })
      .filter(Boolean)
      .slice(0, 12);
    if (!items.length) return <EmptyWidgetState text="No items with both dates" />;
    const min = Math.min(...items.map(i => i._from.getTime()));
    const max = Math.max(...items.map(i => i._to.getTime()));
    const range = max - min || 1;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((i, idx) => {
          const left = ((i._from - min) / range) * 100;
          const width = Math.max(2, ((i._to - i._from) / range) * 100);
          return (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => onOpenItem?.(i.id)}>
              <span style={{ width: 110, fontSize: 11, color: '#323338', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
              <div style={{ flex: 1, height: 18, background: '#f5f6f8', borderRadius: 3, position: 'relative', cursor: 'pointer' }}>
                <div title={`${toISODate(i._from)} → ${toISODate(i._to)}`} style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 2, bottom: 2, background: CHART_COLORS[idx % CHART_COLORS.length], borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9699a6', marginTop: 4, paddingLeft: 118 }}>
          <span>{toISODate(min)}</span>
          <span>{toISODate(max)}</span>
        </div>
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    const dateCols = (board?.columns || []).filter(c => c.type === 'date');
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Start Date Column">
        <select style={selectStyle} value={config.date_from || ''} onChange={e => onChange({ ...config, date_from: e.target.value })}>
          <option value="">— Column —</option>{dateCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="End Date Column">
        <select style={selectStyle} value={config.date_to || ''} onChange={e => onChange({ ...config, date_to: e.target.value })}>
          <option value="">— Column —</option>{dateCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #27: Burndown ─────────────────────────────────────────────────
const BurndownWidget = {
  type: 'burndown', label: 'Burndown', icon: '🔥', category: 'Time',
  desc: 'Ideal vs actual remaining work over a sprint', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const data = computeBurndown(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Pick a status column + done label" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <LineChart data={data} margin={{ top: 12, right: 16, left: -10, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Legend iconType="circle" iconSize={8} />
          <Line type="monotone" dataKey="ideal" stroke="#9699a6" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Ideal" />
          <Line type="monotone" dataKey="actual" stroke="#e2445c" strokeWidth={3} dot={{ r: 4 }} connectNulls name="Actual" />
        </LineChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Status Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Column —</option>{(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="'Done' label"><input style={selectStyle} value={config.done_label || 'Done'} onChange={e => onChange({ ...config, done_label: e.target.value })} /></Field>
      <Field label="Sprint length (days)"><input type="number" min={1} style={selectStyle} value={config.days || 14} onChange={e => onChange({ ...config, days: parseInt(e.target.value) || 14 })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #28: Workload ─────────────────────────────────────────────────
const WorkloadWidget = {
  type: 'workload', label: 'Workload', icon: '👥', category: 'People',
  desc: 'Item count per assigned person', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const data = computeWorkload(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Pick a person column" />;
    const max = Math.max(...data.map(d => d.value), 1);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.slice(0, 12).map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{(d.name || '?').slice(0,2).toUpperCase()}</div>
            <span style={{ fontSize: 12, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden' }}>
              <div style={{ width: `${(d.value/max)*100}%`, height: '100%', background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#676879', minWidth: 24, textAlign: 'right' }}>{d.value}</span>
          </div>
        ))}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Person Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Column —</option>{(board?.columns || []).filter(c => c.type === 'person').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #29: Leaderboard ──────────────────────────────────────────────
const LeaderboardWidget = {
  type: 'leaderboard', label: 'Leaderboard', icon: '🏆', category: 'People',
  desc: 'Top performers by completed items or column total', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const { person_column, status_column, done_label = 'Done' } = config;
    if (!person_column) return <EmptyWidgetState text="Pick a person column" />;
    const items = getFilteredItems(boardData, config.group_ids, filters);
    const counts = {};
    items.forEach(it => {
      if (status_column && it.values?.[status_column] !== done_label) return;
      const persons = parsePersons(it.values?.[person_column]);
      persons.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
    });
    const data = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 10);
    if (!data.length) return <EmptyWidgetState text="No completions yet" />;
    const max = data[0][1];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map(([name, value], i) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: i === 0 ? 'linear-gradient(90deg,#fff8e1,#fff)' : '#f5f6f8' }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? ['#fdab3d','#9699a6','#a0522d'][i] : '#e6e9ef', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i+1}</span>
            <span style={{ flex: 1, fontSize: 13 }}>{name}</span>
            <div style={{ width: 80, height: 6, background: '#e6e9ef', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(value/max)*100}%`, height: '100%', background: '#9b72f5' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#9b72f5', minWidth: 24, textAlign: 'right' }}>{value}</span>
          </div>
        ))}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Person Column">
        <select style={selectStyle} value={config.person_column || ''} onChange={e => onChange({ ...config, person_column: e.target.value })}>
          <option value="">— Column —</option>{(board?.columns || []).filter(c => c.type === 'person').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Status Column (optional, count only Done)">
        <select style={selectStyle} value={config.status_column || ''} onChange={e => onChange({ ...config, status_column: e.target.value })}>
          <option value="">— Any —</option>{(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="'Done' label"><input style={selectStyle} value={config.done_label || 'Done'} onChange={e => onChange({ ...config, done_label: e.target.value })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #30: Team Capacity ────────────────────────────────────────────
const CapacityWidget = {
  type: 'capacity', label: 'Team Capacity', icon: '⚖️', category: 'People',
  desc: 'Each person’s active items vs configured capacity', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const data = computeWorkload(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Pick a person column" />;
    const cap = Number(config.capacity) || 5;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.slice(0, 12).map((d, i) => {
          const pct = Math.min(150, (d.value / cap) * 100);
          const over = d.value > cap;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, width: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              <div style={{ flex: 1, height: 14, background: '#f0f0f0', borderRadius: 7, overflow: 'hidden', position: 'relative' }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: over ? '#e2445c' : pct > 80 ? '#fdab3d' : '#00c875' }} />
                <div style={{ position: 'absolute', left: '100%', transform: 'translateX(-100%)', top: 0, bottom: 0, width: 2, background: '#323338' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: over ? '#e2445c' : '#323338', minWidth: 50, textAlign: 'right' }}>{d.value}/{cap}</span>
            </div>
          );
        })}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Person Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Column —</option>{(board?.columns || []).filter(c => c.type === 'person').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Capacity per person"><input type="number" min={1} style={selectStyle} value={config.capacity || 5} onChange={e => onChange({ ...config, capacity: parseInt(e.target.value) || 5 })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #31: Status Overview Grid ─────────────────────────────────────
const StatusGridWidget = {
  type: 'status_grid', label: 'Status Overview', icon: '🟩', category: 'Status',
  desc: 'One mini-card per status with count and trend', defaultW: 8,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={150} />;
    const data = computeStatusDist(boardData, config, filters);
    if (!data.length) return <EmptyWidgetState text="Pick a status column" />;
    const total = data.reduce((s, d) => s + d.value, 0);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
        {data.map((d, i) => {
          // Wrap the palette — without the modulo, boards with more statuses than
          // palette entries rendered undefined colours past the end.
          const cc = d.color || CHART_COLORS[i % CHART_COLORS.length];
          return (
          <div key={i} style={{ padding: 12, borderRadius: 10, background: `${cc}15`, borderLeft: `4px solid ${cc}` }}>
            <div style={{ fontSize: 11, color: '#676879', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{d.name}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: cc }}>{d.value}</div>
            <div style={{ fontSize: 10, color: '#9699a6' }}>{total ? Math.round(d.value / total * 100) : 0}% of total</div>
          </div>
          );
        })}
      </div>
    );
  },
  ConfigForm: ChartWidget.ConfigForm,
};

// ───── Widget #32: Text / Notes ─────────────────────────────────────────────
const TextWidget = {
  type: 'text', label: 'Text / Notes', icon: '📝', category: 'Content',
  desc: 'Free-form text — announcements, sprint notes, links', defaultW: 4,
  View({ widget, config, isManager, onUpdate }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(config.content || '');
    const save = () => { setEditing(false); onUpdate?.({ content: draft }); };
    if (editing) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} style={{ flex: 1, minHeight: 100, resize: 'vertical', border: '1.5px solid #9b72f5', borderRadius: 6, padding: 10, fontSize: 13, outline: 'none' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => { setEditing(false); setDraft(config.content || ''); }} style={{ padding: '5px 12px', border: '1px solid #e6e9ef', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'transparent', color: '#676879' }}>Cancel</button>
          <button onClick={save} style={{ padding: '5px 14px', background: '#9b72f5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
        </div>
      </div>
    );
    return (
      <div onClick={() => isManager && setEditing(true)} style={{ flex: 1, minHeight: 80, fontSize: 13, lineHeight: 1.6, color: draft ? '#323338' : '#c5c7d0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: isManager ? 'text' : 'default' }}>
        {draft || (isManager ? 'Click to add notes…' : 'No content')}
      </div>
    );
  },
  ConfigForm({ config, onChange }) {
    return (<>
      <Field label="Title"><input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} /></Field>
      <Field label="Content"><textarea style={{ ...selectStyle, minHeight: 100 }} value={config.content || ''} onChange={e => onChange({ ...config, content: e.target.value })} /></Field>
    </>);
  },
};

// ───── Widget #33: Image ────────────────────────────────────────────────────
const ImageWidget = {
  type: 'image', label: 'Image', icon: '🖼', category: 'Content',
  desc: 'Show an image from a URL — logos, banners, charts', defaultW: 4,
  View({ config }) {
    if (!config.url) return <EmptyWidgetState text="Set image URL in config" />;
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={config.url} alt={config.alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: config.fit || 'contain', borderRadius: 6 }} />
      </div>
    );
  },
  ConfigForm({ config, onChange }) {
    return (<>
      <Field label="Image URL"><input style={selectStyle} value={config.url || ''} onChange={e => onChange({ ...config, url: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Alt text"><input style={selectStyle} value={config.alt || ''} onChange={e => onChange({ ...config, alt: e.target.value })} /></Field>
      <Field label="Fit"><ButtonGroup value={config.fit || 'contain'} onChange={v => onChange({ ...config, fit: v })} options={[['contain','Contain'],['cover','Cover'],['fill','Fill']]} /></Field>
    </>);
  },
};

// ───── Widget #34: Iframe / Web Embed ───────────────────────────────────────
const IframeWidget = {
  type: 'iframe', label: 'Web Embed', icon: '🔗', category: 'Content',
  desc: 'Embed an external page or dashboard via iframe', defaultW: 6,
  View({ config }) {
    if (!config.url) return <EmptyWidgetState text="Set URL in config" />;
    return (
      <div style={{ flex: 1, minHeight: 240 }}>
        <iframe src={config.url} title={config.label || 'embed'} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" style={{ width: '100%', height: '100%', minHeight: 240, border: 'none', borderRadius: 6 }} />
      </div>
    );
  },
  ConfigForm({ config, onChange }) {
    return (<>
      <Field label="URL"><input style={selectStyle} value={config.url || ''} onChange={e => onChange({ ...config, url: e.target.value })} placeholder="https://…" /></Field>
      <div style={{ fontSize: 11, color: '#9699a6', marginTop: -10 }}>Some sites block iframe embedding. Use only trusted sources.</div>
    </>);
  },
};

// ───── Widget #35: Grouped (Cluster) Bar ────────────────────────────────────
const GroupedBarWidget = {
  type: 'grouped_bar', label: 'Grouped Bar', icon: '📊', category: 'Charts',
  desc: 'Multiple status bars side-by-side per group (cluster, not stacked)', defaultW: 8,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={220} />;
    const { rows, statuses } = computeStackedByGroup(boardData, config, filters);
    if (!rows.length || !statuses.length) return <EmptyWidgetState text="Pick a status column" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <BarChart data={rows} margin={{ top: 12, right: 12, left: -10, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="group" tick={{ fontSize: 10, fill: '#9699a6' }} interval={0} angle={-25} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#676879' }}>{v}</span>} />
          {statuses.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={s.color || CHART_COLORS[i % CHART_COLORS.length]} radius={[3,3,0,0]} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm: StackedBarWidget.ConfigForm,
};

// ───── Widget #36: Histogram ────────────────────────────────────────────────
const HistogramWidget = {
  type: 'histogram', label: 'Histogram', icon: '📶', category: 'Charts',
  desc: 'Distribution of a number column across auto-bins', defaultW: 6,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={200} />;
    const { column_id, bins = 10 } = config;
    if (!column_id) return <EmptyWidgetState text="Pick a number column" />;
    const items = getFilteredItems(boardData, config.group_ids, filters);
    const vals = items.map(i => parseNumber(i.values?.[column_id])).filter(v => !isNaN(v));
    if (!vals.length) return <EmptyWidgetState text="No numeric values" />;
    const min = Math.min(...vals), max = Math.max(...vals);
    const w = (max - min) / Math.max(bins, 1) || 1;
    const buckets = Array.from({ length: bins }, (_, i) => ({ name: `${(min + i * w).toFixed(1)}`, value: 0 }));
    vals.forEach(v => {
      const idx = Math.min(bins - 1, Math.floor((v - min) / w));
      buckets[idx].value++;
    });
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <BarChart data={buckets} margin={{ top: 12, right: 12, left: -10, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9699a6' }} interval={0} angle={-30} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Bar dataKey="value" radius={[4,4,0,0]}>
            {buckets.map((_, i) => (
              <Cell key={i} fill={config.multicolor ? CHART_COLORS[i % CHART_COLORS.length] : '#9b72f5'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Display"><Toggle checked={!!config.multicolor} onChange={v => onChange({ ...config, multicolor: v })} label="Multicolor bars" /></Field>
      <Field label="Number Column">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Column —</option>
          {(board?.columns || []).filter(c => ['number','formula'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Bins"><input type="number" min={3} max={50} style={selectStyle} value={config.bins || 10} onChange={e => onChange({ ...config, bins: parseInt(e.target.value) || 10 })} /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #37: Quick Stats Row ──────────────────────────────────────────
const QuickStatsWidget = {
  type: 'quick_stats', label: 'Quick Stats Row', icon: '⚡', category: 'KPI',
  desc: 'Strip of compact stat tiles for at-a-glance dashboards', defaultW: 12,
  View({ boardData, config, filters }) {
    if (!boardData) return <SkeletonPulse height={80} />;
    const items = getFilteredItems(boardData, config.group_ids, filters);
    const today = new Date(); today.setHours(0,0,0,0);
    const newToday = items.filter(i => new Date(i.created_at || 0) >= today).length;
    const last7 = items.filter(i => new Date(i.created_at || 0) >= new Date(Date.now() - 7*86400000)).length;
    const total = items.length;
    let done = 0;
    if (config.column_id && config.done_label) {
      done = items.filter(i => i.values?.[config.column_id] === config.done_label).length;
    }
    const tiles = [
      { label: 'Total Items', value: total, color: '#9b72f5' },
      { label: 'New Today', value: newToday, color: '#00c875' },
      { label: 'Last 7 Days', value: last7, color: '#fdab3d' },
      { label: 'Completed', value: done, color: '#a25ddc' },
    ];
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flex: 1 }}>
        {tiles.map(t => (
          <div key={t.label} style={{ padding: 12, borderRadius: 10, background: `${t.color}10`, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#676879', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: t.color, marginTop: 4 }}>{t.value}</div>
          </div>
        ))}
      </div>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    return (<>
      <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v })} />
      <Field label="Status Column (for Completed count)">
        <select style={selectStyle} value={config.column_id || ''} onChange={e => onChange({ ...config, column_id: e.target.value })}>
          <option value="">— Skip —</option>
          {(board?.columns || []).filter(c => ['status','dropdown'].includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="'Done' Label"><input style={selectStyle} value={config.done_label || ''} onChange={e => onChange({ ...config, done_label: e.target.value })} placeholder="Done" /></Field>
      <GroupFilter groups={board?.groups || []} value={config.group_ids} onChange={v => onChange({ ...config, group_ids: v })} />
    </>);
  },
};

// ───── Widget #38: Countdown ────────────────────────────────────────────────
const CountdownWidget = {
  type: 'countdown', label: 'Countdown', icon: '⏳', category: 'Time',
  desc: 'Days remaining until a target date', defaultW: 4,
  View({ config }) {
    if (!config.target_date) return <EmptyWidgetState text="Set a target date" />;
    const target = new Date(config.target_date);
    if (isNaN(target.getTime())) return <EmptyWidgetState text="Invalid date" />;
    const diffMs = target.getTime() - Date.now();
    const days = Math.ceil(diffMs / 86400000);
    const past = days < 0;
    const c = past ? '#e2445c' : days <= 7 ? '#fdab3d' : '#00c875';
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <div style={{ fontSize: 56, fontWeight: 800, color: c, lineHeight: 1 }}>{Math.abs(days)}</div>
        <div style={{ fontSize: 12, color: '#676879' }}>{past ? 'days ago' : 'days remaining'}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#323338', marginTop: 4 }}>{config.label || toISODate(target)}</div>
      </div>
    );
  },
  ConfigForm({ config, onChange }) {
    return (<>
      <Field label="Target Date"><input type="date" style={selectStyle} value={config.target_date || ''} onChange={e => onChange({ ...config, target_date: e.target.value })} /></Field>
      <Field label="Label"><input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} placeholder="Project Launch" /></Field>
    </>);
  },
};

// ───── Widget: History (trend over time from daily snapshots) ────────────────
const HistoryWidget = {
  type: 'history', label: 'History', icon: '📈', category: 'Time',
  desc: 'How a metric changed over time (daily snapshots)', defaultW: 6,
  View({ config }) {
    const [series, setSeries] = useState(null);
    useEffect(() => {
      if (!config.board_id) { setSeries([]); return; }
      let cancelled = false;
      getDashboardSnapshots(config.board_id, config.days || 30)
        .then(rows => {
          if (cancelled) return;
          const metric = config.metric || 'items';
          setSeries((rows || []).map(r => ({
            name: String(r.date).slice(5),
            value: metric === 'items' ? (r.items || 0) : ((r.statuses || {})[metric] || 0),
          })));
        })
        .catch(() => { if (!cancelled) setSeries([]); });
      return () => { cancelled = true; };
    }, [config.board_id, config.metric, config.days]);

    if (series === null) return <SkeletonPulse height={200} />;
    if (!series.length) return <EmptyWidgetState text="No history yet — daily snapshots build up over time" />;
    return (
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <AreaChart data={series} margin={{ top: 16, right: 16, left: -10, bottom: 4 }}>
          <defs><linearGradient id="histg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9b72f5" stopOpacity={0.35} /><stop offset="100%" stopColor="#9b72f5" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e9ef" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9699a6' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9699a6' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 12 }} />
          <Area type="monotone" dataKey="value" stroke="#9b72f5" strokeWidth={2.5} fill="url(#histg)" />
        </AreaChart>
      </ResponsiveContainer>
    );
  },
  ConfigForm({ config, onChange, board, boards }) {
    const statusCol = (board?.columns || []).find(c => c.type === 'status');
    const opts = (statusCol?.settings?.options || []).map(o => (typeof o === 'string' ? o : o.label));
    return (
      <>
        <BoardSelect boards={boards} value={config.board_id} onChange={v => onChange({ ...config, board_id: v, metric: 'items' })} />
        <Field label="Metric">
          <select style={selectStyle} value={config.metric || 'items'} onChange={e => onChange({ ...config, metric: e.target.value })}>
            <option value="items">Total items</option>
            {opts.map(o => <option key={o} value={o}>Status: {o}</option>)}
          </select>
        </Field>
        <Field label="Range">
          <select style={selectStyle} value={config.days || 30} onChange={e => onChange({ ...config, days: Number(e.target.value) })}>
            {[7, 30, 90, 180].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </Field>
      </>
    );
  },
};

// ───── Widget: Cross-board Rollup (one number across many boards) ────────────
const CrossBoardRollupWidget = {
  type: 'cross_rollup', label: 'Cross-board Rollup', icon: '🧮', category: 'KPI',
  desc: 'Aggregate one metric across several boards into a single value', defaultW: 4,
  View({ config, boardCache, onDrill }) {
    const ids = (config.board_ids || []).map(Number);
    if (!ids.length) return <EmptyWidgetState text="Pick boards to roll up" />;
    const metric = config.metric || 'count';
    let total = 0; const breakdown = [];
    for (const id of ids) {
      const bd = boardCache?.[id];
      if (!bd) continue;
      const items = (bd.groups || []).flatMap(g => (g.items || []).map(it => ({ ...it, _groupName: g.name, _groupColor: g.color })));
      let v = 0;
      if (metric === 'count') v = items.length;
      else {
        const col = (bd.columns || []).find(c => (c.title || '').toLowerCase() === String(config.column_title || '').toLowerCase() && ['number', 'rollup', 'formula'].includes(c.type));
        if (col) v = items.reduce((s, it) => { const n = parseNumber(it.values?.[col.id]); return s + (isNaN(n) ? 0 : n); }, 0);
      }
      total += v;
      breakdown.push({ id, name: bd.name, value: v, items });
    }
    const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 4 }}>
        <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
          <div style={{ fontSize: 38, fontWeight: 800, color: '#9b72f5', lineHeight: 1 }}>{fmt(total)}</div>
          <div style={{ fontSize: 12, color: '#676879', marginTop: 4 }}>{config.label || (metric === 'sum' ? config.column_title : 'items')} · {ids.length} boards</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {breakdown.map(b => (
            <div key={b.id} onClick={() => onDrill?.({ title: b.name, items: b.items, columns: boardCache?.[b.id]?.columns || [], boardId: b.id })}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: 7, background: '#f5f6f8', fontSize: 12, cursor: onDrill ? 'pointer' : 'default' }}>
              <span style={{ color: '#323338', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              <b style={{ color: '#9b72f5' }}>{fmt(b.value)}</b>
            </div>
          ))}
        </div>
      </div>
    );
  },
  ConfigForm({ config, onChange, boards }) {
    const sel = config.board_ids || [];
    const toggle = (id) => { const s = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]; onChange({ ...config, board_ids: s }); };
    return (
      <>
        <Field label="Boards">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color,#e6e9ef)', borderRadius: 8, padding: 8 }}>
            {(boards || []).map(b => (
              <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text-primary,#323338)' }}>
                <input type="checkbox" checked={sel.includes(b.id)} onChange={() => toggle(b.id)} style={{ accentColor: '#9b72f5' }} />{b.name}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Metric">
          <ButtonGroup value={config.metric || 'count'} onChange={v => onChange({ ...config, metric: v })} options={[['count', 'Count items'], ['sum', 'Sum a column']]} />
        </Field>
        {config.metric === 'sum' && (
          <Field label="Column title (matched by name across boards)">
            <input style={selectStyle} value={config.column_title || ''} onChange={e => onChange({ ...config, column_title: e.target.value })} placeholder="e.g. Budget" />
          </Field>
        )}
        <Field label="Label"><input style={selectStyle} value={config.label || ''} onChange={e => onChange({ ...config, label: e.target.value })} placeholder="optional" /></Field>
      </>
    );
  },
};

// ───── Registry ─────────────────────────────────────────────────────────────
export const WIDGETS = {
  kpi: KpiWidget,
  kpi_delta: KpiDeltaWidget,
  sparkline: SparklineKpiWidget,
  multi_kpi: MultiMetricWidget,
  cross_rollup: CrossBoardRollupWidget,
  goal: GoalWidget,
  quick_stats: QuickStatsWidget,
  chart: ChartWidget,
  stacked_bar: StackedBarWidget,
  grouped_bar: GroupedBarWidget,
  battery: BatteryWidget,
  trend: TrendWidget,
  cumulative: CumulativeWidget,
  combo: ComboChartWidget,
  funnel: FunnelWidget,
  radar: RadarWidget,
  scatter: ScatterWidget,
  treemap: TreemapWidget,
  heatmap: HeatmapWidget,
  gauge: GaugeWidget,
  radial: RadialWidget,
  histogram: HistogramWidget,
  status_grid: StatusGridWidget,
  summary: SummaryWidget,
  top_n: TopNWidget,
  pivot: PivotWidget,
  items_list: ItemsListWidget,
  activity: ActivityWidget,
  deadlines: DeadlinesWidget,
  calendar: CalendarWidget,
  timeline: TimelineWidget,
  burndown: BurndownWidget,
  history: HistoryWidget,
  countdown: CountdownWidget,
  workload: WorkloadWidget,
  leaderboard: LeaderboardWidget,
  capacity: CapacityWidget,
  text: TextWidget,
  image: ImageWidget,
  iframe: IframeWidget,
};

export const WIDGET_CATEGORIES = [
  { name: 'KPI & Metrics', types: ['kpi','kpi_delta','sparkline','multi_kpi','cross_rollup','goal','quick_stats'] },
  { name: 'Charts', types: ['chart','stacked_bar','grouped_bar','battery','trend','cumulative','combo','funnel','radar','scatter','treemap','heatmap','gauge','radial','histogram'] },
  { name: 'Status', types: ['status_grid'] },
  { name: 'Tables & Lists', types: ['summary','top_n','pivot','items_list','activity'] },
  { name: 'Time', types: ['deadlines','calendar','timeline','burndown','history','countdown'] },
  { name: 'People', types: ['workload','leaderboard','capacity'] },
  { name: 'Content', types: ['text','image','iframe'] },
];
