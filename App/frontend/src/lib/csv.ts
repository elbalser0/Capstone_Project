/** Downloads rows as "{prefix}-fall-2026.csv", quoting every cell. */
export function downloadCsv(prefix: string, termLabel: string, lines: string[][]) {
  const csv = lines.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${prefix}-${termLabel.replace(' ', '-').toLowerCase()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
