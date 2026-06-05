// Single source of truth for date display in the UI.
// Every visible date is ISO yyyy-mm-dd in IST (Asia/Kolkata).
// Timestamps that need a time component use yyyy-mm-dd HH:mm (24-hour, IST).
//
// Timezone is pinned to Asia/Kolkata regardless of the viewer's browser
// timezone — the product is India-based, so a US/UTC traveller should still
// see the same dates as a colleague sitting in Mumbai.

const TZ = 'Asia/Kolkata';

// en-CA's date format is natively YYYY-MM-DD — saves manual padding.
const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

// en-GB with hour12:false yields HH:mm in 24-hour form.
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});

function _toDate(d) {
  if (!d && d !== 0) return null;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? null : date;
}

export function toISODate(d) {
  const date = _toDate(d);
  if (!date) return '';
  return DATE_FMT.format(date);
}

export function toISODateTime(d) {
  const date = _toDate(d);
  if (!date) return '';
  return `${DATE_FMT.format(date)} ${TIME_FMT.format(date)}`;
}

// HH:mm in IST (24-hour). Use this instead of Date#getHours/getMinutes so the
// time matches the rest of the app regardless of the viewer's browser timezone.
export function toISTTime(d) {
  const date = _toDate(d);
  if (!date) return '';
  return TIME_FMT.format(date);
}
