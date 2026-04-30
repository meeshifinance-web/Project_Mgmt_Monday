// Shared compute helpers and constants for dashboard widgets
export const CHART_COLORS = [
  '#0073ea', '#00c875', '#fdab3d', '#e2445c', '#a25ddc',
  '#037f4c', '#ff7575', '#7e3af2', '#0086c0', '#579bfc',
  '#ff158a', '#bb3354', '#9aadbd', '#66ccff', '#fdab3d',
];

export const ACCENT_PALETTE = ['#0073ea', '#00c875', '#fdab3d', '#e2445c', '#a25ddc', '#037f4c', '#7e3af2', '#0086c0'];

export function getFilteredItems(boardData, group_ids, dashboardFilters = {}) {
  if (!boardData) return [];
  const groups = boardData.groups || [];
  const filtered = group_ids?.length ? groups.filter(g => group_ids.includes(String(g.id))) : groups;
  let items = filtered.flatMap(g => (g.items || []).map(i => ({ ...i, _groupName: g.name, _groupColor: g.color })));

  // Apply dashboard-level date range filter on created_at
  if (dashboardFilters.dateFrom || dashboardFilters.dateTo) {
    const from = dashboardFilters.dateFrom ? new Date(dashboardFilters.dateFrom).getTime() : -Infinity;
    const to = dashboardFilters.dateTo ? new Date(dashboardFilters.dateTo).getTime() + 86400000 : Infinity;
    items = items.filter(i => {
      const t = new Date(i.created_at || i.createdAt || 0).getTime();
      return t >= from && t <= to;
    });
  }

  // Apply person filter
  if (dashboardFilters.person && boardData.columns) {
    const personCols = boardData.columns.filter(c => c.type === 'person').map(c => String(c.id));
    if (personCols.length) {
      items = items.filter(i => {
        return personCols.some(cid => {
          const raw = i.values?.[cid];
          if (!raw) return false;
          try {
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr.includes(dashboardFilters.person) : String(arr) === dashboardFilters.person;
          } catch { return String(raw) === dashboardFilters.person; }
        });
      });
    }
  }

  return items;
}

export function getColumn(boardData, column_id) {
  return boardData?.columns?.find(c => String(c.id) === String(column_id));
}

export function getStatusOptions(col) {
  return col?.settings?.options || [];
}

export function parseNumber(v) {
  if (v == null || v === '') return NaN;
  const n = parseFloat(v);
  return isNaN(n) ? NaN : n;
}

export function parsePersons(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [String(raw)];
  } catch { return raw ? [String(raw)] : []; }
}

export function computeKpi(boardData, config, filters) {
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const { column_id, metric = 'count' } = config;
  if (metric === 'count') return items.length;
  if (!column_id) return 0;
  const vals = items.map(i => parseNumber(i.values?.[column_id])).filter(v => !isNaN(v));
  if (!vals.length) return 0;
  if (metric === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (metric === 'avg') return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
  if (metric === 'min') return Math.min(...vals);
  if (metric === 'max') return Math.max(...vals);
  if (metric === 'median') {
    const s = [...vals].sort((a,b) => a-b);
    const m = Math.floor(s.length/2);
    return s.length % 2 ? s[m] : parseFloat(((s[m-1]+s[m])/2).toFixed(2));
  }
  return vals.length;
}

export function computeStatusDist(boardData, config, filters) {
  const { column_id, group_ids } = config;
  if (!column_id || !boardData) return [];
  const col = getColumn(boardData, column_id);
  const options = getStatusOptions(col);
  const items = getFilteredItems(boardData, group_ids, filters);
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

export function computeStackedByGroup(boardData, config, filters) {
  // Returns array of { group: groupName, [statusLabel]: count, ... }
  const { column_id } = config;
  if (!column_id || !boardData) return { rows: [], statuses: [] };
  const col = getColumn(boardData, column_id);
  const options = getStatusOptions(col);
  const groups = boardData.groups || [];
  const useGroups = config.group_ids?.length ? groups.filter(g => config.group_ids.includes(String(g.id))) : groups;

  const statusSet = new Set(options.map(o => o.label));
  const rows = useGroups.map(g => {
    const row = { group: g.name, _color: g.color };
    options.forEach(o => { row[o.label] = 0; });
    (g.items || []).forEach(it => {
      const v = it.values?.[column_id] || 'Empty';
      row[v] = (row[v] || 0) + 1;
      statusSet.add(v);
    });
    return row;
  });

  const statuses = options
    .map(o => ({ name: o.label, color: o.color || '#c4c4c4' }))
    .concat(Array.from(statusSet)
      .filter(s => !options.find(o => o.label === s))
      .map(s => ({ name: s, color: '#c4c4c4' })));
  return { rows, statuses };
}

export function computeWorkload(boardData, config, filters) {
  const { column_id } = config;
  if (!column_id || !boardData) return [];
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const counts = {};
  items.forEach(item => {
    let owners = parsePersons(item.values?.[column_id]);
    if (!owners.length) owners = ['Unassigned'];
    owners.forEach(o => { counts[o] = (counts[o] || 0) + 1; });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
}

export function computeDeadlines(boardData, config, filters) {
  const { column_id, days_ahead = 7 } = config;
  if (!column_id || !boardData) return [];
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const result = [];
  items.forEach(item => {
    const raw = item.values?.[column_id];
    if (!raw) return;
    const d = new Date(raw); if (isNaN(d.getTime())) return;
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((d - now) / 86400000);
    if (diffDays <= Number(days_ahead)) {
      result.push({ id: item.id, name: item.name, date: d, diffDays, raw });
    }
  });
  return result.sort((a, b) => a.date - b.date).slice(0, 50);
}

export function computeGroupSummary(boardData, config, filters) {
  if (!boardData) return [];
  const groups = boardData.groups || [];
  const filtered = config.group_ids?.length ? groups.filter(g => config.group_ids.includes(String(config.group_ids))) : groups;
  return filtered.map(g => ({ id: g.id, name: g.name, color: g.color || '#579bfc', count: (g.items || []).length }));
}

export function computeTrend(boardData, config, filters) {
  const { granularity = 'week', column_id } = config;
  if (!boardData) return [];
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const buckets = {};
  items.forEach(item => {
    const raw = column_id ? item.values?.[column_id] : (item.created_at || item.createdAt);
    if (!raw) return;
    const d = new Date(raw); if (isNaN(d.getTime())) return;
    let key;
    if (granularity === 'day') key = d.toISOString().slice(0, 10);
    else if (granularity === 'month') key = d.toISOString().slice(0, 7);
    else if (granularity === 'quarter') key = `${d.getFullYear()}-Q${Math.floor(d.getMonth()/3)+1}`;
    else if (granularity === 'year') key = String(d.getFullYear());
    else { // week
      const tmp = new Date(d); tmp.setHours(0, 0, 0, 0);
      tmp.setDate(tmp.getDate() - tmp.getDay());
      key = tmp.toISOString().slice(0, 10);
    }
    buckets[key] = (buckets[key] || 0) + 1;
  });
  return Object.entries(buckets).sort(([a],[b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value }));
}

export function computeCumulative(boardData, config, filters) {
  const trend = computeTrend(boardData, config, filters);
  let running = 0;
  return trend.map(t => ({ name: t.name, value: t.value, cumulative: (running += t.value) }));
}

export function computeKpiWithDelta(boardData, config, filters) {
  const value = computeKpi(boardData, config, filters);
  const days = Number(config.compare_days) || 30;
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 86400000);
  const prevCutoff = new Date(now.getTime() - 2 * days * 86400000);
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const inPrev = items.filter(i => {
    const t = new Date(i.created_at || 0).getTime();
    return t >= prevCutoff.getTime() && t < cutoff.getTime();
  });
  const inCurr = items.filter(i => {
    const t = new Date(i.created_at || 0).getTime();
    return t >= cutoff.getTime();
  });
  let prev, curr;
  if (config.metric === 'sum' && config.column_id) {
    prev = inPrev.reduce((s, i) => s + (parseNumber(i.values?.[config.column_id]) || 0), 0);
    curr = inCurr.reduce((s, i) => s + (parseNumber(i.values?.[config.column_id]) || 0), 0);
  } else { prev = inPrev.length; curr = inCurr.length; }
  const delta = prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);
  return { value, prev, curr, delta };
}

export function computeSparklineSeries(boardData, config, filters) {
  // Generate last N days/weeks of cumulative or count
  const days = Number(config.spark_days) || 30;
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const now = new Date(); now.setHours(0,0,0,0);
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86400000);
    const key = day.toISOString().slice(0, 10);
    const count = items.filter(it => {
      const t = it.created_at && it.created_at.slice(0, 10);
      return t === key;
    }).length;
    series.push({ name: key, value: count });
  }
  return series;
}

export function computeTopN(boardData, config, filters) {
  const { sort_column, n = 5, direction = 'desc' } = config;
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const scored = items.map(i => {
    let val = sort_column ? i.values?.[sort_column] : 0;
    const num = parseNumber(val);
    return { id: i.id, name: i.name, value: isNaN(num) ? val : num, sortVal: isNaN(num) ? 0 : num, group: i._groupName };
  });
  scored.sort((a, b) => direction === 'asc' ? a.sortVal - b.sortVal : b.sortVal - a.sortVal);
  return scored.slice(0, Number(n));
}

export function computePivot(boardData, config, filters) {
  // rows = group, cols = status, value = count
  const { row_field = 'group', col_column_id, metric = 'count', value_column_id } = config;
  if (!boardData || !col_column_id) return { rows: [], cols: [], cells: {} };
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const colCol = getColumn(boardData, col_column_id);
  const colOpts = getStatusOptions(colCol);
  const colSet = new Set(colOpts.map(o => o.label));
  const rowSet = new Set();
  const cells = {};

  items.forEach(item => {
    const colVal = item.values?.[col_column_id] || 'Empty';
    let rowVal;
    if (row_field === 'group') rowVal = item._groupName || 'Ungrouped';
    else rowVal = item.values?.[row_field] || 'Empty';
    rowSet.add(rowVal); colSet.add(colVal);
    const key = rowVal + '||' + colVal;
    if (metric === 'count') cells[key] = (cells[key] || 0) + 1;
    else if (value_column_id) {
      const num = parseNumber(item.values?.[value_column_id]);
      if (!isNaN(num)) {
        if (!cells[key]) cells[key] = { sum: 0, count: 0 };
        cells[key].sum += num; cells[key].count++;
      }
    }
  });
  const finalCells = {};
  Object.entries(cells).forEach(([k, v]) => {
    if (typeof v === 'number') finalCells[k] = v;
    else finalCells[k] = metric === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : v.sum;
  });
  return { rows: Array.from(rowSet), cols: Array.from(colSet), cells: finalCells, colOpts };
}

export function computeHeatmap(boardData, config, filters) {
  // x = day-of-week (0-6), y = hour-of-day (0-23) or week-of-year
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const { mode = 'dow_hour' } = config;
  const grid = {};
  items.forEach(it => {
    const d = new Date(it.created_at || 0); if (isNaN(d.getTime())) return;
    let x, y;
    if (mode === 'dow_hour') { x = d.getDay(); y = d.getHours(); }
    else { x = d.getDay(); y = Math.floor(d.getDate() / 7); }
    const k = `${x}-${y}`;
    grid[k] = (grid[k] || 0) + 1;
  });
  return grid;
}

export function computeCalendar(boardData, config, filters) {
  // Returns map { 'YYYY-MM-DD': [items] } for items with date column
  const { column_id } = config;
  if (!column_id) return {};
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const map = {};
  items.forEach(it => {
    const raw = it.values?.[column_id];
    if (!raw) return;
    const d = new Date(raw); if (isNaN(d.getTime())) return;
    const key = d.toISOString().slice(0, 10);
    map[key] = map[key] || [];
    map[key].push(it);
  });
  return map;
}

export function computeFunnel(boardData, config, filters) {
  // Stages = ordered list of status labels; counts items at each stage
  const { column_id, stages = [] } = config;
  if (!column_id || !stages.length) return [];
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const counts = {};
  items.forEach(it => {
    const v = it.values?.[column_id] || '';
    counts[v] = (counts[v] || 0) + 1;
  });
  return stages.map(s => ({ name: s, value: counts[s] || 0 }));
}

export function computeBurndown(boardData, config, filters) {
  // Total scope = all items; remaining over time = items not "done"
  const { column_id, done_label = 'Done', days = 14 } = config;
  if (!column_id) return [];
  const items = getFilteredItems(boardData, config.group_ids, filters);
  const total = items.length;
  const ideal = [];
  const actual = [];
  const now = new Date(); now.setHours(0,0,0,0);
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getTime() - (days - i) * 86400000);
    ideal.push({ name: d.toISOString().slice(5, 10), ideal: Math.round(total * (1 - i / days)) });
  }
  // Actual: count of items still not "done" assuming we don't know completion dates → fallback equal to current remaining at all points
  const currentRemaining = items.filter(i => i.values?.[column_id] !== done_label).length;
  return ideal.map((p, idx) => ({ ...p, actual: idx === ideal.length - 1 ? currentRemaining : null }));
}

export function truncate(s, n = 16) {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : s;
}
