import React, { useMemo, useState } from 'react';

// Map view. Plots items that carry a Location column.
//
// A Location value may be either:
//   • coordinates  — "lat,lng"  or JSON {lat,lng,address}  → plotted on a map
//   • a place name — "Mumbai", "Berlin office", …          → grouped into buckets
//
// Coordinates are drawn on a lightweight equirectangular graticule (no external
// tile server — the app's CSP keeps network calls to same-origin). Place-name
// values without coordinates are listed as location buckets beneath the map.

const GROUP_COLORS = ['#9b72f5', '#0073ea', '#00c875', '#fdab3d', '#e2445c', '#a25ddc', '#0086c0', '#ff642e'];

function parseLocation(raw) {
  if (!raw) return null;
  // JSON form
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') {
      const lat = Number(p.lat ?? p.latitude), lng = Number(p.lng ?? p.lon ?? p.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, label: p.address || p.name || `${lat}, ${lng}` };
      if (p.address || p.name) return { label: String(p.address || p.name) };
    }
  } catch { /* not JSON */ }
  // "lat,lng" form
  const m = String(raw).match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]), lng = Number(m[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng, label: `${lat}, ${lng}` };
  }
  return { label: String(raw).trim() };
}

export default function MapView({ groups = [], columns = [], onOpenDetail }) {
  const locCols = columns.filter(c => c.type === 'location' || /location|address|city|place/i.test(c.title));
  const [colId, setColId] = useState(locCols[0]?.id ?? null);
  const locCol = locCols.find(c => c.id === colId) || locCols[0];

  const { pins, buckets } = useMemo(() => {
    const pins = [], bucketMap = {};
    if (locCol) {
      groups.forEach((g, gi) => {
        const color = g.color || GROUP_COLORS[gi % GROUP_COLORS.length];
        for (const item of g.items || []) {
          const parsed = parseLocation(item.values?.[locCol.id]);
          if (!parsed) continue;
          if (parsed.lat != null) pins.push({ item, group: g, color, ...parsed });
          else {
            const key = parsed.label || 'Unknown';
            (bucketMap[key] = bucketMap[key] || []).push({ item, group: g, color });
          }
        }
      });
    }
    const buckets = Object.entries(bucketMap).map(([label, list]) => ({ label, list })).sort((a, b) => b.list.length - a.list.length);
    return { pins, buckets };
  }, [groups, locCol]);

  if (!locCols.length) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🗺️</div>
        <div>Add a Location column to use Map view</div>
      </div>
    );
  }

  const W = 1000, H = 500;
  const project = (lat, lng) => ({ x: ((lng + 180) / 360) * W, y: ((90 - lat) / 180) * H });

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {pins.length} pinned · {buckets.reduce((s, b) => s + b.list.length, 0)} by place name
        </div>
        <div style={{ flex: 1 }} />
        {locCols.length > 1 && (
          <select value={colId ?? ''} onChange={e => setColId(Number(e.target.value))}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 13 }}>
            {locCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {/* Map canvas */}
      {pins.length > 0 && (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden', marginBottom: 18, background: '#0b1f3a' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            {/* graticule */}
            {Array.from({ length: 11 }, (_, i) => (
              <line key={`lat${i}`} x1={0} x2={W} y1={(i / 10) * H} y2={(i / 10) * H} stroke="#1d3a5f" strokeWidth={1} />
            ))}
            {Array.from({ length: 13 }, (_, i) => (
              <line key={`lng${i}`} y1={0} y2={H} x1={(i / 12) * W} x2={(i / 12) * W} stroke="#1d3a5f" strokeWidth={1} />
            ))}
            {/* equator + prime meridian, emphasised */}
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#2c5587" strokeWidth={1.5} />
            <line y1={0} y2={H} x1={W / 2} x2={W / 2} stroke="#2c5587" strokeWidth={1.5} />
            {/* pins */}
            {pins.map((p, i) => {
              const { x, y } = project(p.lat, p.lng);
              return (
                <g key={i} style={{ cursor: 'pointer' }} onClick={() => onOpenDetail?.(p.item.id)}>
                  <circle cx={x} cy={y} r={7} fill={p.color} stroke="#fff" strokeWidth={2} opacity={0.92}>
                    <title>{`${p.item.name}\n${p.label}`}</title>
                  </circle>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Place-name buckets */}
      {buckets.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Locations</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {buckets.map(b => (
              <div key={b.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 15 }}>📍</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 10, padding: '1px 8px' }}>{b.list.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {b.list.slice(0, 6).map(({ item, color }) => (
                    <button key={item.id} onClick={() => onOpenDetail?.(item.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', cursor: 'pointer', padding: '2px 0' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    </button>
                  ))}
                  {b.list.length > 6 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{b.list.length - 6} more</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pins.length === 0 && buckets.length === 0 && (
        <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-secondary)' }}>No location values set on any item yet.</div>
      )}
    </div>
  );
}
