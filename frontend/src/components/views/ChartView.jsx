import React, { useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Legend as RLegend,
} from 'recharts';
import {
  computeStatusDist, computeWorkload, computeGroupSummary, computeTrend, CHART_COLORS,
} from '../dashboard/helpers';

// A configurable single-chart board view. Pick a chart type and a dimension to
// break items down by; everything is derived live from the board's own data.

export default function ChartView({ groups = [], columns = [] }) {
  const boardData = useMemo(() => ({ columns, groups }), [columns, groups]);

  // Build the list of dimensions the user can group by.
  const dimensions = useMemo(() => {
    const dims = [{ key: 'group', label: 'Group', kind: 'group' }];
    for (const c of columns) {
      if (c.type === 'status' || c.type === 'dropdown') dims.push({ key: `status:${c.id}`, label: c.title, kind: 'status', col: c });
      if (c.type === 'person') dims.push({ key: `person:${c.id}`, label: c.title, kind: 'person', col: c });
      if (c.type === 'date' || c.type === 'timeline') dims.push({ key: `trend:${c.id}`, label: `${c.title} (over time)`, kind: 'trend', col: c });
    }
    return dims;
  }, [columns]);

  const [dimKey, setDimKey] = useState(dimensions[1]?.key || 'group');
  const [chartType, setChartType] = useState('bar');
  const dim = dimensions.find(d => d.key === dimKey) || dimensions[0];

  const isTrend = dim?.kind === 'trend';

  const data = useMemo(() => {
    if (!dim) return [];
    if (dim.kind === 'group') {
      return computeGroupSummary(boardData, {}).map((g, i) => ({ name: g.name, value: g.count, color: g.color || CHART_COLORS[i % CHART_COLORS.length] }));
    }
    if (dim.kind === 'status') {
      return computeStatusDist(boardData, { column_id: dim.col.id });
    }
    if (dim.kind === 'person') {
      return computeWorkload(boardData, { column_id: dim.col.id }).map((d, i) => ({ ...d, color: CHART_COLORS[i % CHART_COLORS.length] }));
    }
    if (dim.kind === 'trend') {
      return computeTrend(boardData, { column_id: dim.col.id, granularity: 'week' });
    }
    return [];
  }, [boardData, dim]);

  const total = data.reduce((s, d) => s + (d.value || 0), 0);

  const TYPES = [['bar', '▦ Bar'], ['pie', '◔ Pie'], ['donut', '◍ Donut'], ['line', '📈 Line']];

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
          Break down by
          <select value={dimKey} onChange={e => setDimKey(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 13 }}>
            {dimensions.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          {TYPES.map(([t, label]) => {
            const disabled = isTrend && t !== 'line';
            return (
              <button key={t} disabled={disabled} onClick={() => setChartType(t)}
                title={disabled ? 'Over-time data shows as a line' : ''}
                style={{
                  padding: '5px 11px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--border-color)', opacity: disabled ? 0.4 : 1,
                  background: (chartType === t && !isTrend) || (isTrend && t === 'line') ? 'rgba(155,114,245,0.16)' : 'var(--card-bg)',
                  color: (chartType === t && !isTrend) || (isTrend && t === 'line') ? '#9b72f5' : 'var(--text-secondary)',
                }}>{label}</button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{total} items</span>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, minHeight: 320 }}>
        {!data.length ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No data to chart for this dimension yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {(isTrend || chartType === 'line') ? (
              <LineChart data={data} margin={{ top: 12, right: 20, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#9b72f5" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            ) : chartType === 'bar' ? (
              <BarChart data={data} margin={{ top: 12, right: 20, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? 'end' : 'middle'} height={data.length > 5 ? 60 : 30} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip cursor={{ fill: 'rgba(155,114,245,0.08)' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {data.map((d, i) => <Cell key={i} fill={d.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
                  <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                </Bar>
              </BarChart>
            ) : (
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={chartType === 'donut' ? 70 : 0} outerRadius={120} paddingAngle={2}>
                  {data.map((d, i) => <Cell key={i} fill={d.color || CHART_COLORS[i % CHART_COLORS.length]} />)}
                  <LabelList dataKey="value" position="outside" style={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                </Pie>
                <Tooltip />
                <RLegend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
