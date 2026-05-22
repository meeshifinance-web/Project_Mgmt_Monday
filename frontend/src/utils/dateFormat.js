// Single source of truth for date display in the UI.
// Every visible date is ISO yyyy-mm-dd. Timestamps that need a time component
// use yyyy-mm-dd HH:mm (24-hour, ISO-style).

function _toDate(d) {
  if (!d && d !== 0) return null;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? null : date;
}

export function toISODate(d) {
  const date = _toDate(d);
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toISODateTime(d) {
  const date = _toDate(d);
  if (!date) return '';
  const datePart = toISODate(date);
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${datePart} ${h}:${min}`;
}
