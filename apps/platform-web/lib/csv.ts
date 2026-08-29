/**
 * A tiny RFC 4180 CSV writer shared by the governance exports (the decision log,
 * the pending-review load). Pure and deterministic, so each caller's column
 * mapping is unit-testable and the escaping lives in one place.
 */

// RFC 4180: a field is quoted when it contains a comma, quote, CR or LF, and any
// embedded quote is doubled. Everything is stringified first so a stray non-string
// never throws.
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A header row then one line per row, CRLF-separated with a trailing CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return lines.join('\r\n') + '\r\n';
}
