import React, { useMemo } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import {
  computeKpi, computeStatusDist, computeWorkload, computeDeadlines, computeGroupSummary,
} from './dashboard/helpers';
import { toISODate } from '../utils/dateFormat';

// A board-scoped, auto-generated dashboard rendered as a board VIEW (alongside
// Table / Kanban). Unlike the global Dashboards in the sidebar, this needs no
// configuration — it derives sensible widgets from the board's own columns and
// items. Purely read-only; it never mutates board data.

const GROUP_COLORS = ['#9b72f5', '#0073ea', '#00c875', '#fdab3d', '#e2445c', '#a25ddc', '#0086c0', '#ff642e', '#578ef7', '#cab641'];

function Card({ title, children, span = 1 }) {
  return (
    <div style={{
      gridColumn: `span ${span}`, background: 'var(--card-bg, #fff)',
      border: '1px solid var(--border-color, #e6e9ef)', borderRadius: 12,
      padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {title && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary, #676879)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  );
}

function Kpi({ label, value, color = '#9b72f5' }) {
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 6, padding: '6px 0' }}>
        <div style={{ fontSize: 40, fontWeight: 800, color, lineHeight: 1, letterSpacing: -1.5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #676879)', fontWeight: 500, textAlign: 'center' }}>{label}</div>
      </div>
    </Card>
  );
}

function EmptyHint({ children }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #9699a6)', fontSize: 12, textAlign: 'center', minHeight: 120 }}>{children}</div>;
}

export default function BoardDashboardView({ groups = [], columns = [], boardName }) {
  const boardData = useMemo(() => ({ columns, groups }), [columns, groups]);

  const statusCol = columns.find(c => c.type === 'status');
  const personCol = columns.find(c => c.type === 'person');
  const dateCol   = columns.find(c => c.type === 'date');
  const numberCol = columns.find(c => c.type === 'number');

  const totalItems = useMemo(() => computeKpi(boardData, { metric: 'count' }), [boardData]);
  const groupSummary = useMemo(() => computeGroupSummary(boardData, {}), [boardData]);
  const statusDist = useMemo(() => statusCol ? computeStatusDist(boardData, { column_id: statusCol.id }) : [], [boardData, statusCol]);
  const workload = useMemo(() => personCol ? computeWorkload(boardData, { column_id: personCol.id }) : [], [boardData, personCol]);
  const deadlines = useMemo(() => dateCol ? computeDeadlines(boardData, { column_id: dateCol.id, days_ahead: 14 }) : [], [boardData, dateCol]);

  const doneCount = useMemo(() => statusDist.find(s => /done|complete/i.test(s.name))?.value || 0, [statusDist]);
  const donePct = totalItems ? Math.round((doneCount / totalItems) * 100) : 0;
  const overdue = useMemo(() => deadlines.filter(d => d.diffDays < 0).length, [deadlines]);

  const groupBars = groupSummary.map((g, i) => ({ name: g.name, value: g.count, color: g.color || GROUP_COLORS[i % GROUP_COLORS.length] }));

  if (!groups.length) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>No data to summarise yet.</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', alignItems: 'stretch',
      }}>
        {/* KPI row */}
        <Kpi label="Total items" value={totalItems} color="#9b72f5" />
        <Kpi label="Groups" value={groupSummary.length} color="#0073ea" />
        {statusCol && <Kpi label={`% Done`} value={`${donePct}%`} color="#00c875" />}
        {dateCol && <Kpi label="Overdue" value={overdue} color={overdue ? '#e2445c' : '#00c875'} />}
        {!statusCol && !dateCol && <Kpi label="Avg / group" value={groupSummary.length ? Math.round(totalItems / groupSummary.length) : 0} color="#fdab3d" />}

        {/* Status distribution */}
        <Card title={statusCol ? `Status — ${statusCol.title}` : 'Status'} span={2}>
          {statusCol && statusDist.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {statusDist.map((d, i) => <Cell key={i} fill={d.color || GROUP_COLORS[i % GROUP_COLORS.length]} />)}
                  <LabelList dataKey="value" position="outside" style={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyHint>{statusCol ? 'No status values yet.' : 'Add a Status column to see a breakdown.'}</EmptyHint>}
          {statusCol && statusDist.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'center' }}>
              {statusDist.map((d, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color || GROUP_COLORS[i % GROUP_COLORS.length] }} />
                  {d.name} ({d.value})
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Items per group */}
        <Card title="Items per group" span={2}>
          {groupBars.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={groupBars} margin={{ top: 10, right: 10, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #eee)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} interval={0} angle={groupBars.length > 4 ? -20 : 0} textAnchor={groupBars.length > 4 ? 'end' : 'middle'} height={groupBars.length > 4 ? 60 : 30} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip cursor={{ fill: 'rgba(155,114,245,0.08)' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {groupBars.map((g, i) => <Cell key={i} fill={g.color} />)}
                  <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyHint>No groups yet.</EmptyHint>}
        </Card>

        {/* Workload by owner */}
        <Card title={personCol ? `Workload — ${personCol.title}` : 'Workload'} span={2}>
          {personCol && workload.length ? (
            <ResponsiveContainer width="100%" height={Math.max(180, Math.min(workload.length, 8) * 34)}>
              <BarChart data={workload.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 20, left: 10, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip cursor={{ fill: 'rgba(155,114,245,0.08)' }} />
                <Bar dataKey="value" fill="#0073ea" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyHint>{personCol ? 'No owners assigned yet.' : 'Add a People column to see workload.'}</EmptyHint>}
        </Card>

        {/* Upcoming deadlines */}
        <Card title={dateCol ? `Upcoming — ${dateCol.title}` : 'Upcoming deadlines'} span={2}>
          {dateCol && deadlines.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 260 }}>
              {deadlines.slice(0, 12).map(d => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '7px 10px', borderRadius: 7, background: 'var(--bg-secondary, #f7f8fc)' }}>
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || 'Untitled'}</span>
                  <span style={{ flexShrink: 0, fontWeight: 600, color: d.diffDays < 0 ? '#e2445c' : d.diffDays <= 2 ? '#fdab3d' : 'var(--text-secondary)' }}>
                    {toISODate(d.raw)} {d.diffDays < 0 ? `· ${Math.abs(d.diffDays)}d overdue` : d.diffDays === 0 ? '· today' : `· in ${d.diffDays}d`}
                  </span>
                </div>
              ))}
            </div>
          ) : <EmptyHint>{dateCol ? 'Nothing due in the next 14 days.' : 'Add a Date column to track deadlines.'}</EmptyHint>}
        </Card>
      </div>
    </div>
  );
}
