const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

export function formatRelativeDate(date: Date, now = Date.now()): string {
  const diffMs = date.getTime() - now;
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (Math.abs(diffMs) >= unitMs || unit === 'second') {
      return RELATIVE_TIME_FORMAT.format(Math.round(diffMs / unitMs), unit);
    }
  }
  return RELATIVE_TIME_FORMAT.format(0, 'second');
}
