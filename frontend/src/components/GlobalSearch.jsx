import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

export default function GlobalSearch({ onClose, onOpenBoard }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await axios.get(`/api/search?q=${encodeURIComponent(query)}`);
        setResults(r.data);
        setSelectedIdx(0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const flat = results.flatMap(g => g.items.map(item => ({ ...item, board_id: g.board_id })));

  const handleSelect = useCallback((item) => {
    onOpenBoard(item.board_id, item.id);
    onClose();
  }, [onOpenBoard, onClose]);

  const handleKey = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && flat[selectedIdx]) handleSelect(flat[selectedIdx]);
  };

  let flatIdx = 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg-primary)', borderRadius: 12, width: 580, maxWidth: '94vw', maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: 16, opacity: 0.5 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search across all boards…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: 'var(--text-primary)', fontFamily: 'inherit' }}
          />
          {loading && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Searching…</span>}
          <kbd style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-color)', fontFamily: 'inherit' }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {query.length < 2 && (
            <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
              Type at least 2 characters to search
            </div>
          )}
          {query.length >= 2 && !loading && results.length === 0 && (
            <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
              No results found for "<strong>{query}</strong>"
            </div>
          )}
          {results.map(group => (
            <div key={group.board_id}>
              <div style={{ padding: '10px 18px 4px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.5px', textTransform: 'uppercase', background: 'var(--bg-secondary)' }}>
                📋 {group.board_name}
              </div>
              {group.items.map(item => {
                const idx = flatIdx++;
                const isSelected = idx === selectedIdx;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelect({ ...item, board_id: group.board_id })}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    style={{
                      padding: '10px 18px 10px 32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: isSelected ? 'var(--hover-bg)' : 'transparent',
                      borderLeft: isSelected ? '3px solid #0073ea' : '3px solid transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{item.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 12, flexShrink: 0 }}>{item.group_name}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div style={{ padding: '8px 18px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>
          <span>↑↓ Navigate</span><span>↵ Open board</span><span>Esc Close</span>
          {flat.length > 0 && <span style={{ marginLeft: 'auto' }}>{flat.length} result{flat.length !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    </div>
  );
}
