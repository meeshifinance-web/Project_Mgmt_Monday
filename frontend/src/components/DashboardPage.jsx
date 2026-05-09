import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Responsive as RGLResponsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';

const ResponsiveGridLayout = WidthProvider(RGLResponsive);

// Default row-height per widget type (rowHeight = 60px)
const DEFAULT_H = {
  kpi: 3, kpi_delta: 3, sparkline: 3, multi_kpi: 3, goal: 3, quick_stats: 3, countdown: 3,
  chart: 5, stacked_bar: 5, grouped_bar: 5, battery: 4, trend: 5, cumulative: 5, combo: 5,
  funnel: 5, radar: 5, scatter: 5, treemap: 5, heatmap: 5, gauge: 4, radial: 5, histogram: 5,
  status_grid: 4, summary: 5, top_n: 5, pivot: 6, items_list: 6, activity: 5,
  deadlines: 5, calendar: 6, timeline: 5, burndown: 5,
  workload: 5, leaderboard: 5, capacity: 5,
  text: 4, image: 4, iframe: 6,
};

// Auto-pack widgets that have no saved position (legacy default grid_y = 9999).
function buildLayout(widgets) {
  let cursorX = 0, cursorY = 0, rowMaxH = 0;
  return widgets.map(w => {
    const hasPos = Number.isFinite(w.grid_x) && Number.isFinite(w.grid_y) && w.grid_y < 9000;
    const ww = w.grid_w || 6;
    const hh = w.grid_h || DEFAULT_H[w.type] || 4;
    let x, y;
    if (hasPos) { x = w.grid_x; y = w.grid_y; }
    else {
      if (cursorX + ww > 12) { cursorX = 0; cursorY += rowMaxH; rowMaxH = 0; }
      x = cursorX; y = cursorY;
      cursorX += ww; rowMaxH = Math.max(rowMaxH, hh);
    }
    return { i: String(w.id), x, y, w: ww, h: hh, minW: 3, minH: 3, maxW: 12 };
  });
}
import {
  getDashboardWidgets, createDashboardWidget, updateDashboardWidget,
  deleteDashboardWidget, updateDashboard, getBoard,
} from '../api';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { WIDGETS, WIDGET_CATEGORIES } from './dashboard/widgets';
import { WidgetCard, Field, selectStyle } from './dashboard/common';


// ── Dashboard-level filters bar ──────────────────────────────────────────────
function FiltersBar({ filters, onChange, boards, onExport, isManager, onAdd, widgetsCount }) {
  const [open, setOpen] = useState(false);
  const active = !!(filters.dateFrom || filters.dateTo || filters.person);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 24px', background: 'var(--bg-primary,#fff)',
      borderBottom: '1px solid var(--border-color,#e6e9ef)', flexShrink: 0,
      minHeight: 52,
    }}>
      <button onClick={() => setOpen(!open)}
        style={{ padding: '6px 12px', border: `1.5px solid ${active ? '#9b72f5' : 'var(--border-color,#e6e9ef)'}`, borderRadius: 7, fontSize: 12, fontWeight: 600, background: active ? 'rgba(155,114,245,0.18)' : 'transparent', color: active ? '#9b72f5' : 'var(--text-secondary,#676879)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        🎚 Filters{active && ' •'}
      </button>
      {open && (
        <>
          <input type="date" value={filters.dateFrom || ''} onChange={e => onChange({ ...filters, dateFrom: e.target.value })} style={{ padding: '5px 8px', border: '1px solid var(--border-color,#e6e9ef)', borderRadius: 6, fontSize: 12, background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#323338)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted,#9699a6)' }}>→</span>
          <input type="date" value={filters.dateTo || ''} onChange={e => onChange({ ...filters, dateTo: e.target.value })} style={{ padding: '5px 8px', border: '1px solid var(--border-color,#e6e9ef)', borderRadius: 6, fontSize: 12, background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#323338)' }} />
          {active && <button onClick={() => onChange({})} style={{ padding: '5px 10px', background: 'transparent', border: 'none', color: '#e2445c', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Clear</button>}
        </>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted,#9699a6)' }}>{widgetsCount} widget{widgetsCount !== 1 ? 's' : ''}</span>
        <button onClick={onExport} title="Print / Export" style={{ padding: '6px 12px', border: '1px solid var(--border-color,#e6e9ef)', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary,#676879)' }}>🖨 Export</button>
        {isManager && <button onClick={onAdd} style={{ padding: '7px 16px', background: '#9b72f5', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Add Widget</button>}
      </div>
    </div>
  );
}

// ── Add / Edit Widget Modal ──────────────────────────────────────────────────
function WidgetModal({ initial, boards, boardDataCache, onFetchBoard, onSave, onClose }) {
  const isEdit = !!initial;
  const [step, setStep] = useState(isEdit ? 'config' : 'type');
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState(initial?.type || null);
  const [config, setConfig] = useState(initial?.config || {});
  const [title, setTitle] = useState(initial?.title || '');
  const [width, setWidth] = useState(initial?.grid_w || 6);

  const def = selectedType ? WIDGETS[selectedType] : null;
  const boardId = config.board_id;
  const [localBoardData, setLocalBoardData] = useState(boardDataCache?.[boardId] || null);

  useEffect(() => {
    if (!boardId) { setLocalBoardData(null); return; }
    if (boardDataCache?.[boardId]) { setLocalBoardData(boardDataCache[boardId]); return; }
    getBoard(boardId).then(r => { setLocalBoardData(r.data); onFetchBoard?.(boardId, r.data); }).catch(() => {});
  }, [boardId]);

  const handleSave = () => onSave({ type: selectedType, title: title || def?.label || '', config, grid_w: width });

  const filteredCats = useMemo(() => {
    if (!search) return WIDGET_CATEGORIES;
    const s = search.toLowerCase();
    return WIDGET_CATEGORIES.map(cat => ({
      ...cat,
      types: cat.types.filter(t => {
        const w = WIDGETS[t];
        return w && (w.label.toLowerCase().includes(s) || (w.desc || '').toLowerCase().includes(s));
      }),
    })).filter(cat => cat.types.length);
  }, [search]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 720, background: 'var(--card-bg,#fff)', color: 'var(--text-primary,#323338)', border: '1px solid var(--border-color,#e6e9ef)', borderRadius: 14, boxShadow: '0 16px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '90vh' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-color,#e6e9ef)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary,#323338)', margin: 0 }}>
              {isEdit ? 'Configure Widget' : step === 'type' ? `Add Widget — choose from ${Object.keys(WIDGETS).length} types` : `Configure: ${def?.label}`}
            </h3>
            {!isEdit && step === 'config' && (
              <button onClick={() => setStep('type')} style={{ fontSize: 12, color: '#9b72f5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}>← Back</button>
            )}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--sidebar-btn-bg, rgba(255,255,255,0.10))', color: 'var(--text-primary,#676879)', fontSize: 20, fontWeight: 800, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {step === 'type' ? (
            <>
              <input autoFocus placeholder="Search widgets…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ ...selectStyle, marginBottom: 14, fontSize: 14, padding: '10px 12px' }} />
              {filteredCats.map(cat => (
                <div key={cat.name} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted,#9699a6)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>{cat.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {cat.types.map(t => {
                      const w = WIDGETS[t];
                      return (
                        <div key={t} onClick={() => { setSelectedType(t); setWidth(w.defaultW || 6); setConfig({}); setTitle(''); setStep('config'); }}
                          style={{ padding: '12px 14px', borderRadius: 8, border: '1.5px solid var(--border-color,#e6e9ef)', background: 'var(--bg-primary,transparent)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, transition: 'all 0.15s', minHeight: 90 }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#9b72f5'; e.currentTarget.style.background = 'var(--hover-bg, rgba(155,114,245,0.10))'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color,#e6e9ef)'; e.currentTarget.style.background = 'var(--bg-primary,transparent)'; }}>
                          <span style={{ fontSize: 22 }}>{w.icon}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary,#323338)' }}>{w.label}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted,#9699a6)', lineHeight: 1.4 }}>{w.desc}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <Field label="Widget Title">
                <input style={selectStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder={def?.label} />
              </Field>
              <Field label="Width">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[[4,'Narrow (1/3)'],[6,'Half (1/2)'],[8,'Wide (2/3)'],[12,'Full']].map(([w, l]) => (
                    <button key={w} onClick={() => setWidth(w)}
                      style={{ flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${width === w ? '#9b72f5' : 'var(--border-color,#e6e9ef)'}`, background: width === w ? 'rgba(155,114,245,0.18)' : 'transparent', color: width === w ? '#9b72f5' : 'var(--text-secondary,#676879)' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </Field>
              {def?.ConfigForm && <def.ConfigForm config={config} onChange={setConfig} board={localBoardData} boards={boards} />}
            </>
          )}
        </div>

        {step === 'config' && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color,#e6e9ef)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border-color,#e6e9ef)', background: 'transparent', color: 'var(--text-secondary,#676879)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#9b72f5', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {isEdit ? 'Update Widget' : 'Add Widget'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main DashboardPage ───────────────────────────────────────────────────────
export default function DashboardPage({ dashboardId, dashboard, boards, onDashboardUpdate }) {
  const toast = useToast();
  const { isManager } = useAuth();

  const [widgets, setWidgets] = useState([]);
  const [loadingWidgets, setLoadingWidgets] = useState(true);
  const [boardDataCache, setBoardDataCache] = useState({});
  const [loadingBoardIds, setLoadingBoardIds] = useState(new Set());

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWidget, setEditingWidget] = useState(null);
  const [filters, setFilters] = useState({});

  const [dashName, setDashName] = useState(dashboard?.name || '');
  const [editingName, setEditingName] = useState(false);
  const gridRef = useRef(null);

  useEffect(() => {
    setLoadingWidgets(true);
    getDashboardWidgets(dashboardId)
      .then(data => { setWidgets(data); setLoadingWidgets(false); })
      .catch(() => { toast('Failed to load widgets', 'error'); setLoadingWidgets(false); });
  }, [dashboardId]);

  useEffect(() => {
    const boardIds = new Set();
    widgets.forEach(w => {
      const bid = w.config?.board_id;
      if (bid) boardIds.add(Number(bid));
      // multi_kpi has metrics with their own board_ids
      (w.config?.metrics || []).forEach(m => { if (m.board_id) boardIds.add(Number(m.board_id)); });
    });
    [...boardIds].forEach(boardId => {
      if (boardDataCache[boardId] || loadingBoardIds.has(boardId)) return;
      setLoadingBoardIds(prev => new Set([...prev, boardId]));
      getBoard(boardId)
        .then(res => {
          setBoardDataCache(prev => ({ ...prev, [boardId]: res.data }));
          setLoadingBoardIds(prev => { const s = new Set(prev); s.delete(boardId); return s; });
        })
        .catch(() => setLoadingBoardIds(prev => { const s = new Set(prev); s.delete(boardId); return s; }));
    });
  }, [widgets]);

  useEffect(() => { setDashName(dashboard?.name || ''); }, [dashboard?.name]);

  // Force charts to remeasure after the RGL grid first lays out, and on every drag/resize end.
  useEffect(() => {
    if (loadingWidgets || !widgets.length) return;
    const t1 = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    const t2 = setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loadingWidgets, widgets.length]);

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

  const handleAddWidget = async (data) => {
    try {
      const created = await createDashboardWidget(dashboardId, data);
      setWidgets(prev => [...prev, created]);
      setShowAddModal(false);
      toast('Widget added', 'success');
    } catch { toast('Failed to add widget', 'error'); }
  };

  const handleUpdateWidget = async (data) => {
    try {
      const updated = await updateDashboardWidget(dashboardId, editingWidget.id, data);
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

  const handleResize = async (widget, newW) => {
    try {
      const updated = await updateDashboardWidget(dashboardId, widget.id, { grid_w: newW });
      setWidgets(prev => prev.map(w => w.id === updated.id ? updated : w));
    } catch { toast('Resize failed', 'error'); }
  };

  // Save the new positions / sizes after drag or resize. Skips noop layouts.
  const layoutSaveTimer = useRef(null);
  const handleLayoutChange = (layout) => {
    if (!isManager) return;
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      const byId = new Map(widgets.map(w => [String(w.id), w]));
      const changes = [];
      const updatedLocal = widgets.map(w => {
        const l = layout.find(li => li.i === String(w.id));
        if (!l) return w;
        if (l.x === w.grid_x && l.y === w.grid_y && l.w === w.grid_w && l.h === (w.grid_h || 4)) return w;
        changes.push({ id: w.id, grid_x: l.x, grid_y: l.y, grid_w: l.w, grid_h: l.h });
        return { ...w, grid_x: l.x, grid_y: l.y, grid_w: l.w, grid_h: l.h };
      });
      if (!changes.length) return;
      setWidgets(updatedLocal);
      Promise.all(changes.map(c => updateDashboardWidget(dashboardId, c.id, { grid_x: c.grid_x, grid_y: c.grid_y, grid_w: c.grid_w, grid_h: c.grid_h })))
        .catch(() => toast('Failed to save layout', 'error'));
    }, 400);
  };

  const handleTextUpdate = async (widgetId, configUpdate) => {
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;
    try {
      const updated = await updateDashboardWidget(dashboardId, widgetId, { config: { ...widget.config, ...configUpdate } });
      setWidgets(prev => prev.map(w => w.id === updated.id ? updated : w));
    } catch { toast('Failed to save', 'error'); }
  };

  const handleExport = () => {
    // Print-based export — works without extra deps; user can save as PDF
    window.print();
  };

  const renderWidget = (widget) => {
    const def = WIDGETS[widget.type];
    if (!def) return <div style={{ padding: 20, color: 'var(--text-muted,#9699a6)', fontSize: 12 }}>Unknown widget type: {widget.type}</div>;
    const cfg = widget.config || {};
    const bd = boardDataCache[cfg.board_id];
    const View = def.View;
    return (
      <View
        boardData={bd}
        config={cfg}
        widget={widget}
        filters={filters}
        boardCache={boardDataCache}
        isManager={isManager}
        onUpdate={(upd) => handleTextUpdate(widget.id, upd)}
      />
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary,#f5f6f8)' }}>
      {/* Top bar */}
      <div style={{ background: 'var(--bg-primary,#fff)', borderBottom: '1px solid var(--border-color,#e6e9ef)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>📊</span>
        {editingName ? (
          <input autoFocus value={dashName} onChange={e => setDashName(e.target.value)} onBlur={handleSaveName}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setDashName(dashboard?.name || ''); setEditingName(false); } }}
            style={{ fontSize: 18, fontWeight: 700, border: '2px solid #9b72f5', borderRadius: 6, padding: '2px 8px', outline: 'none', background: 'transparent', color: 'var(--text-primary,#323338)', minWidth: 200 }} />
        ) : (
          <h2 onClick={() => isManager && setEditingName(true)} title={isManager ? 'Click to rename' : undefined}
            style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary,#323338)', margin: 0, cursor: isManager ? 'pointer' : 'default' }}>
            {dashName}
          </h2>
        )}
      </div>

      <FiltersBar
        filters={filters} onChange={setFilters}
        boards={boards} onExport={handleExport}
        isManager={isManager} onAdd={() => setShowAddModal(true)}
        widgetsCount={widgets.length}
      />

      <div ref={gridRef} className="dashboard-grid-print" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loadingWidgets ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
            {[6,4,6,12,4,8].map((w, i) => (
              <div key={i} style={{ gridColumn: `span ${w}`, height: 200, borderRadius: 12, background: 'linear-gradient(90deg,var(--bg-primary) 25%,var(--hover-bg) 50%,var(--bg-primary) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s ease-in-out infinite' }} />
            ))}
          </div>
        ) : widgets.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 56 }}>📊</span>
            <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary,#323338)', margin: 0 }}>Your dashboard is empty</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted,#9699a6)', margin: 0 }}>Choose from {Object.keys(WIDGETS).length}+ widget types to visualize your data</p>
            {isManager && <button onClick={() => setShowAddModal(true)} style={{ padding: '10px 24px', background: '#9b72f5', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 8 }}>+ Add Your First Widget</button>}
          </div>
        ) : (
          <ResponsiveGridLayout
            className="dashboard-rgl"
            layouts={{ lg: buildLayout(widgets) }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={60}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            isDraggable={isManager}
            isResizable={isManager}
            draggableHandle=".widget-drag-handle"
            resizeHandles={['se']}
            onLayoutChange={handleLayoutChange}
            onResizeStop={() => window.dispatchEvent(new Event('resize'))}
            onDragStop={() => window.dispatchEvent(new Event('resize'))}
            measureBeforeMount={false}
            compactType="vertical"
            useCSSTransforms
          >
            {widgets.map(widget => (
              <div key={String(widget.id)}>
                <WidgetCard
                  widget={widget}
                  isManager={isManager}
                  onEdit={setEditingWidget}
                  onDelete={handleDeleteWidget}
                >
                  {renderWidget(widget)}
                </WidgetCard>
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>

      {showAddModal && (
        <WidgetModal boards={boards} boardDataCache={boardDataCache} onFetchBoard={handleFetchBoard} onSave={handleAddWidget} onClose={() => setShowAddModal(false)} />
      )}
      {editingWidget && (
        <WidgetModal initial={editingWidget} boards={boards} boardDataCache={boardDataCache} onFetchBoard={handleFetchBoard} onSave={handleUpdateWidget} onClose={() => setEditingWidget(null)} />
      )}

      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .dashboard-rgl .react-grid-placeholder { background: #9b72f5 !important; opacity: 0.18 !important; border-radius: 12px !important; }
        .dashboard-rgl .react-resizable-handle { background-image: none; }
        .dashboard-rgl .react-resizable-handle::after { content: ''; position: absolute; right: 4px; bottom: 4px; width: 8px; height: 8px; border-right: 2px solid #c5c7d0; border-bottom: 2px solid #c5c7d0; border-bottom-right-radius: 2px; }
        .dashboard-rgl .widget-drag-handle:active { cursor: grabbing; }
        @media print {
          body * { visibility: hidden; }
          .dashboard-grid-print, .dashboard-grid-print * { visibility: visible; }
          .dashboard-grid-print { position: absolute; top: 0; left: 0; width: 100%; padding: 0 !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
