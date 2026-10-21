import type { Finding } from '../core/findings.js';
import type { SourceAccount } from '../core/source.js';
import { VAT_ACCOUNT_TYPES, WILDCARD, lineLabel, rowKey, type MappingRow, type MappingRowValues } from './types.js';

/**
 * What `init-mapping --update` tells the owner of an existing file, which it
 * never rewrites (s10 design decision 7):
 * - `N-PARENT-ROW-EMPTY` for a row of a container account (`hasChildren`) with
 *   an empty DATEV account: the resolver now passes over it to the wildcard
 *   rows, so it no longer blocks and may be deleted (`3000;Liabilities` from
 *   template version 1);
 * - `N-TEMPLATE-SUGGESTION` for a row with an empty DATEV account for which the
 *   current template has a suggestion (no-show and cancellation fees at 7 %).
 */
export function updateNotes(rows: readonly MappingRow[], accounts: readonly SourceAccount[], suggested: readonly MappingRowValues[]): Finding[] {
  const containers = new Set(accounts.filter((a) => a.hasChildren).map((a) => `${a.number}\u0000${a.type}`));
  const suggestions = new Map(suggested.filter((row) => row.datevAccount !== '').map((row) => [rowKey(row), row]));
  const notes: Finding[] = [];
  for (const row of rows) {
    if (row.datevAccount !== '' || VAT_ACCOUNT_TYPES.has(row.apaleoType)) continue;
    const account = `${row.apaleoAccount} (${row.apaleoType})`;
    if (row.apaleoAccount !== WILDCARD && containers.has(`${row.apaleoAccount}\u0000${row.apaleoType}`)) {
      notes.push({
        code: 'N-PARENT-ROW-EMPTY',
        message:
          `${lineLabel(row)}: the parent account ${account} has no DATEV account. It no longer blocks the accounts under it: ` +
          'they resolve through the wildcard rows (*) of their type and rate. You may delete the row',
        value: row.apaleoAccount,
      });
    }
    const suggestion = suggestions.get(rowKey(row));
    if (suggestion) {
      notes.push({
        code: 'N-TEMPLATE-SUGGESTION',
        message:
          `${lineLabel(row)}: the template now suggests DATEV account ${suggestion.datevAccount} for ${account}` +
          `${suggestion.datevVatPercent === '' ? '' : ` at ${suggestion.datevVatPercent} %`}. ` +
          `Fill it in if your Steuerberater agrees: ${suggestion.comment}`,
        value: row.apaleoAccount,
      });
    }
  }
  return notes;
}
