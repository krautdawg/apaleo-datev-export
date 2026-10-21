/**
 * Plain-text columns separated by two spaces. Columns listed in `right` are
 * right-aligned (amounts). Each row becomes one line with the given indent.
 */
export function formatTable(rows: readonly (readonly string[])[], right: readonly number[] = [], indent = ''): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows
    .map((row) => {
      const cells = row.map((cell, i) => (right.includes(i) ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0)));
      return `${indent}${cells.join('  ').trimEnd()}\n`;
    })
    .join('');
}
