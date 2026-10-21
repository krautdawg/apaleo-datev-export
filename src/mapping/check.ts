import type { ChartIndex } from '../core/chart.js';
import { REPORT_PROBLEM_HINT } from '../core/errors.js';
import type { Finding } from '../core/findings.js';
import { formatCents } from '../core/money.js';
import { ACCOUNT_TYPES, type AccountRef, type LedgerLine } from '../core/source.js';
import { accountLengthFinding } from './account-length.js';
import { automaticRate, isAllowedOnAutomatic, isAutomaticLifted, taxKeyRate } from './automatic-accounts.js';
import { resolve } from './resolve.js';
import { isHistoricalRow, shippedTemplate, templateWildcardAccount } from './template.js';
import {
  ANY_TYPE,
  PERSONAL_ACCOUNT_TYPE,
  VAT_ACCOUNT_TYPES,
  VAT_RELEVANT_TYPES,
  WILDCARD,
  parsePercent,
  type Mapping,
  type MappingRow,
  type Skr,
} from './types.js';

export interface CheckMappingOptions {
  sachkontenlaenge: number;
  /** The Mandant's chart. Without it the Automatikkonto checks are skipped (`N-SKR-UNKNOWN`). */
  skr?: Skr | undefined;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([...ACCOUNT_TYPES, ANY_TYPE]);

/** apaleo types whose lines are sales, deposits or bad debt: they owe output tax, never input tax. */
const OUTPUT_TAX_TYPES: ReadonlySet<string> = new Set([...VAT_RELEVANT_TYPES].filter((type) => !VAT_ACCOUNT_TYPES.has(type)));

/**
 * Offline validation of a loaded mapping: digits only, exact account length,
 * BU key format, no BU key on an Automatikkonto, `datev_vat_percent` against
 * the rate the account or BU key implies, and the VAT rate DATEV will apply
 * against the apaleo rate. Structural problems (duplicates, forbidden
 * wildcards) already fail `loadMapping`.
 */
export function checkMapping(mapping: Mapping, options: CheckMappingOptions): Finding[] {
  const findings: Finding[] = [];
  const skr = options.skr ?? mapping.skr;
  if (mapping.layout === 'grman') {
    findings.push({
      code: 'W-GRMAN-LAYOUT',
      message:
        'this is a Grman connector export: it has no BU keys and no VAT rates, and its rows match account numbers ' +
        'of any type. Run "apaleo-datev init-mapping --update" to convert it and add the missing columns',
    });
  }
  if (!skr) {
    findings.push({
      code: 'N-SKR-UNKNOWN',
      message: 'the SKR is unknown, so Automatikkonten were not checked. Pass --skr 03 or --skr 04',
    });
  }
  const ignored = mapping.rows.filter((row) => VAT_ACCOUNT_TYPES.has(row.apaleoType));
  if (ignored.length > 0) {
    findings.push({
      code: 'N-VAT-ROW-IGNORED',
      message:
        `${ignored.length} row(s) for Vat or VatOnLiabilities accounts (${ignored.map((r) => `line ${r.line}`).join(', ')}) ` +
        'are ignored: those lines are always skipped because DATEV computes the VAT from the Automatikkonten',
    });
  }
  for (const row of mapping.rows) {
    if (!VAT_ACCOUNT_TYPES.has(row.apaleoType)) findings.push(...checkRow(row, options.sachkontenlaenge, skr));
  }
  return findings;
}

function checkRow(row: MappingRow, sachkontenlaenge: number, skr: Skr | undefined): Finding[] {
  const where = `line ${row.line}`;
  const findings: Finding[] = [];
  if (!KNOWN_TYPES.has(row.apaleoType)) {
    findings.push({
      code: 'W-UNKNOWN-TYPE',
      message: `${where}: apaleo_type "${row.apaleoType}" is not an apaleo account type (${ACCOUNT_TYPES.join(', ')})`,
      field: 'apaleo_type',
      value: row.apaleoType,
    });
  }
  for (const [field, text] of [['apaleo_vat_percent', row.apaleoVatPercent], ['datev_vat_percent', row.datevVatPercent]] as const) {
    if (Number.isNaN(parsePercent(text) ?? 0)) {
      findings.push({ code: 'E-VAT-PERCENT', message: `${where}: ${field} "${text}" is not a percentage`, field, value: text });
    }
  }
  if (row.buKey !== '' && !/^\d{1,4}$/.test(row.buKey)) {
    findings.push({ code: 'E-BU-KEY', message: `${where}: BU key "${row.buKey}" must have 1 to 4 digits`, field: 'bu_key', value: row.buKey });
  }
  if (row.datevAccount === '') return findings;

  if (!/^\d+$/.test(row.datevAccount)) {
    findings.push({
      code: 'E-ACCOUNT-DIGITS',
      message: `${where}: DATEV account "${row.datevAccount}" must contain digits only`,
      field: 'datev_account',
      value: row.datevAccount,
    });
    return findings;
  }
  const length = accountLengthFinding(row, sachkontenlaenge);
  if (length) findings.push(length);

  const automatic = skr === undefined ? undefined : automaticRate(skr, row.datevAccount, sachkontenlaenge);
  if (automatic !== undefined && row.buKey !== '' && !isAllowedOnAutomatic(row.buKey)) {
    findings.push({
      code: 'E-BU-ON-AUTOMATIC',
      message:
        `${where}: DATEV account ${row.datevAccount} is an Automatikkonto (SKR ${skr}, ${automatic} %); DATEV computes the VAT ` +
        `itself and rejects the BU key ${row.buKey} on it. Leave bu_key empty`,
      field: 'bu_key',
      value: row.buKey,
    });
  }
  const implied = impliedVatRate(row, sachkontenlaenge, skr);
  const explicit = parsePercent(row.datevVatPercent);
  if (!implied && /^\d{1,4}$/.test(row.buKey)) {
    const known = explicit !== undefined && !Number.isNaN(explicit);
    findings.push({
      code: 'W-BU-KEY-UNCHECKED',
      message:
        `${where}: the tool does not know BU key ${row.buKey}${automatic === undefined ? '' : ` on Automatikkonto ${row.datevAccount}`}` +
        `${skr === undefined ? ' (or the SKR is unknown, so it cannot tell an Automatikkonto)' : ''}, ` +
        (known
          ? `so it trusts datev_vat_percent (${explicit} %) for the VAT rate DATEV applies. `
          : 'and datev_vat_percent is empty, so it cannot check the VAT rate DATEV applies. ') +
        'Have your Steuerberater confirm the key',
      field: 'bu_key',
      value: row.buKey,
    });
  }
  const taxKey = taxKeyRate(automatic === undefined ? row.buKey : isAutomaticLifted(row.buKey) ? row.buKey.slice(1) : '');
  if (taxKey?.side === 'input' && OUTPUT_TAX_TYPES.has(row.apaleoType)) {
    findings.push({
      code: 'E-BU-INPUT-TAX',
      message:
        `${where}: BU key ${row.buKey} books ${taxKey.rate} % input tax (Vorsteuer), but apaleo type ${row.apaleoType} is a sale, ` +
        'deposit or bad debt and owes output tax (Umsatzsteuer). Use an Automatikkonto with an empty bu_key, or the output-tax ' +
        'key 2 (7 %) or 3 (19 %), and have your Steuerberater confirm it',
      field: 'bu_key',
      value: row.buKey,
    });
  }
  if (implied && explicit !== undefined && !Number.isNaN(explicit) && explicit !== implied.rate) {
    findings.push({
      code: 'E-VAT-CONFLICT',
      message:
        `${where}: datev_vat_percent says ${explicit} %, but DATEV will apply ${implied.rate} % because of ${implied.reason}. ` +
        `Correct datev_vat_percent to ${implied.rate} or change the DATEV account or BU key`,
      field: 'datev_vat_percent',
      value: row.datevVatPercent,
    });
  }
  const datevRate = datevVatRate(row, sachkontenlaenge, skr);
  const apaleoRate = parsePercent(row.apaleoVatPercent);
  if (datevRate !== undefined && apaleoRate !== undefined && !Number.isNaN(apaleoRate) && datevRate !== apaleoRate) {
    findings.push({
      code: 'E-VAT-MISMATCH',
      message:
        `${where}: apaleo account ${row.apaleoAccount} (${row.apaleoType}) has VAT ${apaleoRate} %, but DATEV will apply ` +
        `${datevRate} % on account ${row.datevAccount}${implied ? ` (${implied.reason})` : ''}. ` +
        `Map it to an account for ${apaleoRate} % or fix the BU key or datev_vat_percent`,
      field: 'datev_vat_percent',
      value: String(datevRate),
    });
  }
  return findings;
}

/**
 * The VAT rate DATEV derives from the account and BU key alone, ignoring
 * `datev_vat_percent`: on a known Automatikkonto the account's rate, or 0 with
 * an Aufhebung key `40` (`4x` applies the tax key `x` instead); else the rate
 * of a known tax key (`2`, `3`, `8`, `9`, also after a Generalumkehr `2x`).
 * Undefined when neither gives a rate, for example for a key the tool does not
 * know (`checkMapping` warns `W-BU-KEY-UNCHECKED`).
 */
export function impliedVatRate(
  row: Pick<MappingRow, 'datevAccount' | 'buKey'>,
  sachkontenlaenge: number,
  skr: Skr | undefined,
): { rate: number; reason: string } | undefined {
  const automatic = skr === undefined ? undefined : automaticRate(skr, row.datevAccount, sachkontenlaenge);
  if (automatic !== undefined) {
    if (isAutomaticLifted(row.buKey)) {
      const inner = row.buKey.slice(1);
      const rate = inner === '0' ? 0 : taxKeyRate(inner)?.rate;
      if (rate === undefined) return undefined;
      return { rate, reason: `BU key ${row.buKey}, which lifts the automatic ${automatic} % of Automatikkonto ${row.datevAccount}` };
    }
    return { rate: automatic, reason: `Automatikkonto ${row.datevAccount} (SKR ${skr}, ${automatic} %)` };
  }
  const key = taxKeyRate(row.buKey);
  if (key) return { rate: key.rate, reason: `BU key ${row.buKey} (${key.rate} % ${key.side} tax)` };
  return undefined;
}

/**
 * The VAT rate DATEV will apply for a row: the rate the account and BU key imply
 * (see `impliedVatRate`), which always wins because DATEV books it whatever the
 * file says; else `datev_vat_percent` if set; else 0 ("no VAT") when there is no
 * BU key. Undefined when it cannot be known: a BU key the tool does not know and
 * no `datev_vat_percent`, the SKR is unknown and neither a rate nor a BU key is
 * given, or the rate is not a number. A `datev_vat_percent` that contradicts
 * the implied rate is reported by `checkMapping` as `E-VAT-CONFLICT`.
 */
export function datevVatRate(row: MappingRow, sachkontenlaenge: number, skr: Skr | undefined): number | undefined {
  const implied = impliedVatRate(row, sachkontenlaenge, skr);
  if (implied) return implied.rate;
  const explicit = parsePercent(row.datevVatPercent);
  if (explicit !== undefined) return Number.isNaN(explicit) ? undefined : explicit;
  return skr === undefined || row.buKey !== '' ? undefined : 0;
}

export interface CoverageOptions {
  /**
   * The rate each line's rows are resolved with. The posting rules' `releaseRateOf`
   * gives the inferred rate of an untaxed deposit release (undefined when none can
   * be inferred) and the line's own rate (`lineRate`) otherwise.
   */
  rateOf: (line: LedgerLine) => number | undefined;
  /** Needed to tell which VAT rate DATEV applies on the resolved row (`E-VAT-MISMATCH`). */
  sachkontenlaenge: number;
  /** The Mandant's chart; default the SKR named in the mapping file. Without it Automatikkonten are not recognised. */
  skr?: Skr | undefined;
}

/** A line without a tax entry left after normalising. */
function isUntaxed(line: LedgerLine): boolean {
  return !line.taxes.some((tax) => tax.percent !== 0 || tax.amountCents !== 0);
}

interface Booked {
  account: AccountRef;
  lines: number;
  grossCents: number;
}

interface Unmapped extends Booked {
  rate: number | undefined;
  row: MappingRow | undefined;
  /**
   * Set for accounts outside the chart with a parent (per-reservation and folio
   * accounts): they are reported once per parent, type and rate.
   */
  group?: { parent: string; accounts: Set<string> };
}

interface Mismatch extends Booked {
  rate: number;
  row: MappingRow;
  datevRate: number;
}

/** Untaxed deposit releases whose VAT rate cannot be inferred. */
interface UnknownRates {
  accounts: Set<string>;
  lines: number;
  grossCents: number;
}

function add<T extends Booked>(map: Map<string, T>, key: string, line: LedgerLine, create: () => T): void {
  const entry = map.get(key) ?? create();
  entry.lines += 1;
  entry.grossCents += line.grossCents;
  map.set(key, entry);
}

const byAccount = (a: Booked, b: Booked) => a.account.type.localeCompare(b.account.type) || a.account.number.localeCompare(b.account.number);

const MAX_EXAMPLES = 3;

/**
 * Checks every account booked in `lines` against the mapping:
 * - `E-UNMAPPED` for an account that does not resolve to a row with a DATEV
 *   account, with its type, name, line count and gross total;
 * - `E-VAT-MISMATCH` for a VAT-relevant account whose row makes DATEV apply
 *   another rate than the line carries, for example a revenue account at 7 %
 *   that resolves through a parent row to an Automatikkonto for 19 %;
 * - `E-VAT-RATE-UNKNOWN` once for all untaxed deposit releases whose rate
 *   `rateOf` cannot infer (the export stops on them).
 * Lines with a Vat or VatOnLiabilities side are skipped by the posting rules,
 * so they need no mapping.
 */
export function checkCoverage(
  mapping: Mapping,
  lines: readonly LedgerLine[],
  chart: ChartIndex | undefined,
  options: CoverageOptions,
): Finding[] {
  const { rateOf } = options;
  const skr = options.skr ?? mapping.skr;
  const resolveAt = (account: AccountRef, rate: number | undefined) => resolve(mapping, account, { rate, ...(chart ? { chart } : {}) });
  const unmapped = new Map<string, Unmapped>();
  const mismatches = new Map<string, Mismatch>();
  const unknownRate: UnknownRates = { accounts: new Set(), lines: 0, grossCents: 0 };
  for (const line of lines) {
    if (VAT_ACCOUNT_TYPES.has(line.debit.type) || VAT_ACCOUNT_TYPES.has(line.credit.type)) continue;
    const rate = rateOf(line);
    for (const account of [line.debit, line.credit]) {
      if (rate === undefined && account.type === 'Liabilities' && isUntaxed(line)) {
        unknownRate.accounts.add(account.number);
        unknownRate.lines += 1;
        unknownRate.grossCents += line.grossCents;
        continue;
      }
      const row = resolveAt(account, rate);
      if (row && row.datevAccount !== '') {
        // A row whose own apaleo_vat_percent equals the line's rate is checked by checkMapping.
        if (rate === undefined || !OUTPUT_TAX_TYPES.has(account.type) || parsePercent(row.apaleoVatPercent) === rate) continue;
        const datevRate = datevVatRate(row, options.sachkontenlaenge, skr);
        if (datevRate === undefined || datevRate === rate) continue;
        add(mismatches, `${row.line}\u0000${account.number}\u0000${account.type}\u0000${rate}`, line, () => ({
          account, rate, row, datevRate, lines: 0, grossCents: 0,
        }));
        continue;
      }
      const rated = VAT_RELEVANT_TYPES.has(account.type) && (!row || row.apaleoAccount !== account.number);
      const parent = !chart?.has(account.number) ? account.parentNumber : undefined;
      const key = `${parent === undefined ? account.number : `parent ${parent}`}\u0000${account.type}${rated ? `\u0000${rate}` : ''}`;
      add(unmapped, key, line, () => ({
        account: parent === undefined ? account : { number: parent, name: chart?.find(parent, account.type)?.name ?? parent, type: account.type },
        rate,
        row,
        lines: 0,
        grossCents: 0,
        ...(parent === undefined ? {} : { group: { parent, accounts: new Set<string>() } }),
      }));
      unmapped.get(key)?.group?.accounts.add(account.number);
    }
  }
  const hint: Hint = {
    sachkontenlaenge: options.sachkontenlaenge,
    skr,
    wildcardRow: (type, rate) =>
      mapping.rows.find((row) => row.apaleoAccount === WILDCARD && row.apaleoType === type && parsePercent(row.apaleoVatPercent) === rate),
  };
  return [
    ...[...unmapped.values()].sort(byAccount).map((entry) => unmappedFinding(entry, hint)),
    ...(unknownRate.lines > 0 ? [unknownRateFinding(unknownRate)] : []),
    ...[...mismatches.values()].sort(byAccount).map((entry) => mismatchFinding(entry, options.sachkontenlaenge, skr)),
  ];
}

function bookedText({ lines, grossCents }: Pick<Booked, 'lines' | 'grossCents'>): string {
  return `${lines} line${lines === 1 ? '' : 's'}, gross ${formatCents(grossCents)}`;
}

interface Hint {
  sachkontenlaenge: number;
  /** The template's accounts are shown as examples when the SKR is known. */
  skr: Skr | undefined;
  /** The mapping's wildcard row for a VAT-relevant type at a rate, if it has one. */
  wildcardRow: (type: string, rate: number) => MappingRow | undefined;
}

/**
 * The fix when an empty parent row wins over an empty wildcard row that already
 * exists (resolve prefers the parent): name that row instead of asking to add it.
 * The template leaves the 2020 rows (5 and 16 %) empty on purpose.
 */
function emptyWildcardFix(wildcard: MappingRow, type: string, rate: number): string {
  if (isHistoricalRow(wildcard)) {
    return (
      `the wildcard row for ${type} at ${rate} % on line ${wildcard.line} is empty on purpose: ${rate} % applied only ` +
      `from 1 July to 31 December 2020. If the lines at ${rate} % are correct, fill in datev_account on line ${wildcard.line} ` +
      `with your Steuerberater; otherwise correct the VAT rate in apaleo`
    );
  }
  return `fill in datev_account on the wildcard row for ${type} at ${rate} % on line ${wildcard.line}`;
}

/** The wildcard row to add for a type, as it is written in the file, with the template's account as example. */
function wildcardHint(type: string, rate: number | undefined, { sachkontenlaenge, skr }: Hint): string {
  const rated = VAT_RELEVANT_TYPES.has(type);
  const template = skr === undefined ? undefined : templateWildcardAccount(shippedTemplate(skr), type, rated ? rate : undefined, sachkontenlaenge);
  if (!rated) {
    const debtor = type === PERSONAL_ACCOUNT_TYPE ? ' (collective debtor)' : '';
    return `the wildcard row \`*;${type};;;${template ?? '<DATEV account>'}\`${debtor}`;
  }
  return `a wildcard row \`*;${type};;${rate};<DATEV account>;;${rate}\`${template === undefined ? '' : ` (template: ${template})`}`;
}

/**
 * `E-UNMAPPED` with the row to change: an exact empty row by its line; an empty
 * parent row with the wildcard row to add instead (for VAT-relevant types never
 * "fill in the parent row": one DATEV account cannot serve every rate); no row
 * at all with the row or wildcard row to add.
 */
function unmappedFinding(entry: Unmapped, hint: Hint): Finding {
  const { account, rate, row, group } = entry;
  const vatRelevant = VAT_RELEVANT_TYPES.has(account.type);
  const at = vatRelevant && rate !== undefined ? ` at ${rate} %` : '';
  let what = `apaleo account ${account.number} (${account.type}, "${account.name}") is`;
  if (group) {
    const accounts = [...group.accounts].sort();
    const more = accounts.length > MAX_EXAMPLES ? ` and ${accounts.length - MAX_EXAMPLES} more` : '';
    const count = accounts.length === 1 ? `1 ${account.type} account` : `${accounts.length} ${account.type} accounts`;
    what = `${count} of reservations or folios under parent ${group.parent}${at} (${accounts.slice(0, MAX_EXAMPLES).join(', ')}${more}) ${accounts.length === 1 ? 'is' : 'are'}`;
  }
  const emptyParent = row && row.apaleoAccount !== WILDCARD && row.apaleoAccount !== (group ? undefined : account.number);
  const wildcard = wildcardHint(account.type, rate, hint);
  let fix: string;
  if (row && !emptyParent) {
    fix = `fill in datev_account on line ${row.line} of the mapping file`;
  } else if (vatRelevant && rate === undefined) {
    fix = `the lines carry more than one VAT rate, so no wildcard applies; add a row for ${account.number} ${account.type}`;
  } else if (account.type === 'Revenues' && row) {
    fix = `the parent row for ${row.apaleoAccount} on line ${row.line} has no DATEV account; add a row for ${account.number} Revenues with a DATEV account for${at}`;
  } else if (account.type === 'Revenues') {
    fix = `add a row with apaleo_account ${account.number}, apaleo_type Revenues and a DATEV account`;
  } else if (row && vatRelevant) {
    const existing = rate === undefined ? undefined : hint.wildcardRow(account.type, rate);
    const add = existing && rate !== undefined ? emptyWildcardFix(existing, account.type, rate) : `add ${wildcard}`;
    fix = `the parent row for ${row.apaleoAccount} on line ${row.line} has no DATEV account and does not apply to ${account.type} at different VAT rates; ${add}`;
  } else if (row) {
    fix = `fill in datev_account for the parent row ${row.apaleoAccount} on line ${row.line}, or add ${wildcard}`;
  } else if (group && vatRelevant) {
    fix = `add ${wildcard}`;
  } else if (group) {
    fix = `add a row for ${group.parent} ${account.type} or ${wildcard}`;
  } else if (vatRelevant) {
    fix = `add a row for ${account.number} ${account.type}, or a wildcard row (*) for ${account.type}${at}: ${wildcard.replace(/^a wildcard row /, '')}`;
  } else {
    fix = `add a row with apaleo_account ${account.number}, apaleo_type ${account.type} and a DATEV account`;
  }
  return {
    code: 'E-UNMAPPED',
    message: `${what} not mapped (${bookedText(entry)}): ${fix}`,
    field: 'apaleo_account',
    value: account.number,
  };
}

function mismatchFinding(entry: Mismatch, sachkontenlaenge: number, skr: Skr | undefined): Finding {
  const { account, rate, row, datevRate } = entry;
  const implied = impliedVatRate(row, sachkontenlaenge, skr);
  const via = row.apaleoAccount === account.number ? `its row on line ${row.line}` : `line ${row.line} (apaleo account ${row.apaleoAccount})`;
  return {
    code: 'E-VAT-MISMATCH',
    message:
      `apaleo account ${account.number} (${account.type}, "${account.name}") is booked at ${rate} % (${bookedText(entry)}), ` +
      `but it uses ${via} of the mapping, and DATEV will apply ${datevRate} % on account ${row.datevAccount}` +
      `${implied ? ` (${implied.reason})` : ''}. Add a row for ${account.number} ${account.type} with a DATEV account for ${rate} %`,
    field: 'apaleo_account',
    value: account.number,
  };
}

/** One finding for all untaxed deposit releases whose VAT rate cannot be inferred. */
function unknownRateFinding(releases: UnknownRates): Finding {
  const accounts = [...releases.accounts].sort();
  const names = accounts.slice(0, 3);
  const more = accounts.length > names.length ? ` and ${accounts.length - names.length} more` : '';
  return {
    code: 'E-VAT-RATE-UNKNOWN',
    message:
      `${releases.lines} deposit release${releases.lines === 1 ? '' : 's'} (${bookedText(releases)}, ` +
      `${accounts.length === 1 ? 'account' : 'accounts'} ${names.join(', ')}${more}): apaleo settled a guest's prepaid deposit ` +
      'against the bill without a VAT amount, and the VAT rate cannot be found: there is no PostPrepaymentVat line of the same day ' +
      'and reservation with a rate, and the chart of accounts gives the deposit account none. The export stops rather than book them ' +
      `without VAT. ${REPORT_PROBLEM_HINT}`,
    field: 'apaleo_account',
    value: names[0] ?? '',
  };
}
