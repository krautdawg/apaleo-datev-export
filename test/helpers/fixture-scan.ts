import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The privacy scan for recorded apaleo responses (s10 design decision 14).
 * It runs before a recording is copied into `test/fixtures/apaleo/live/` and,
 * as a test, over the copied files. A file passes when no key or string value
 * looks like a credential or an e-mail address and every account name is an
 * apaleo default name or a per-reservation or per-folio name.
 *
 * Self-contained (only `node:` imports), so it also runs on its own:
 *   node test/helpers/fixture-scan.ts <folder>
 * Folio recordings (`*_folios_*`) and `.env` files are never read.
 */

const CREDENTIAL = /token|secret|bearer|authori[sz]ation|passw(or)?d|api[-_]?key|client[-_]?id/i;
const EMAIL = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
/** A JSON web token or a long hex secret. */
const TOKEN_VALUE = /\beyJ[\w-]{10,}\.|^[A-Fa-f0-9]{32,}$/;

const RATE = String.raw`\((?:\d+(?:\.\d+)?%|no VAT)\)`;
const DEFAULT_NAME_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`^Revenues(?: (?:Accommodation|Cancellation fees|Food and beverages|No-show|Other))?(?: ${RATE})?$`),
  /^(?:VAT|LiabilitiesVat) (?:Normal|Reduced|Null|Special|Very Reduced|Without) \(\d+(?:\.\d+)?%\)$/,
  /^(?:AccountsReceivable|LossOfAccountsReceivable) for Reservations and Folios without company$/,
];
const DEFAULT_NAMES: ReadonlySet<string> = new Set([
  'Payments', 'Credit Card Payment', 'Amex Credit Card Payment', 'Visa Credit Card Payment', 'Visa Debit Card Payment',
  'MasterCard Credit Card Payment', 'MasterCard Debit Card Payment', 'Maestro Card Payment', 'GiroCard Payment',
  'Discover Credit Card Payment', 'Diners Club Credit Card Payment', 'Jcb Credit Card Payment', 'V Pay Payment',
  'Postcard Payment', 'Reka Payment', 'Twint Payment', 'Lunch-Check Payment', 'Voucher Payment', 'China Union Pay Payment',
  'Other Payment', 'Cheque', 'Payment by Booking.com', 'Airbnb', 'Holiday Check', 'Representation', 'PayPal Payment',
  'Cash and ATM', 'Direct Debit', 'Online banking', 'Open Invoice', 'E-Wallets', 'iDeal', 'Bank Transfer', 'Cash Payment',
  'Vat on Revenue', 'Vat on Prepayment', 'House Account', 'Transitory Items', 'Liabilities', 'Receivables',
  'Accounts Receivable', 'Loss of Accounts Receivable',
]);
/** `Receivables for Folio BER-EXT-1 (Offset)`, `Liabilities for Reservation EPEBVUIU-1 (7%)`. */
const PER_ACCOUNT_NAME = /^(?:Receivables|Liabilities|AccountsReceivable|LossOfAccountsReceivable) for (?:Reservation|Folio) [A-Z0-9]+(?:-[A-Z0-9]+)*(?: \((?:\d+(?:\.\d+)?%|Offset)\))?$/;

export function isAllowedAccountName(name: string): boolean {
  return DEFAULT_NAMES.has(name) || DEFAULT_NAME_PATTERNS.some((p) => p.test(name)) || PER_ACCOUNT_NAME.test(name);
}

/** One problem per offending key, value or account name, with its JSON path. */
export function scanJson(json: unknown, path = '$'): string[] {
  if (Array.isArray(json)) return json.flatMap((item, i) => scanJson(item, `${path}[${i}]`));
  if (typeof json === 'string') {
    if (CREDENTIAL.test(json) || TOKEN_VALUE.test(json)) return [`${path}: value looks like a credential`];
    return EMAIL.test(json) ? [`${path}: value looks like an e-mail address`] : [];
  }
  if (json === null || typeof json !== 'object') return [];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(json)) {
    const at = `${path}.${key}`;
    if (CREDENTIAL.test(key)) problems.push(`${at}: key looks like a credential`);
    if (key === 'name' && typeof value === 'string' && !isAllowedAccountName(value)) {
      problems.push(`${at}: "${value}" is neither an apaleo default name nor a per-reservation or per-folio name`);
    }
    problems.push(...scanJson(value, at));
  }
  return problems;
}

/** Every JSON file under `folder` except folio recordings; `.env` files are never opened. */
export function scanFolder(folder: string): { files: number; problems: string[] } {
  const files = readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.json') && !file.includes('_folios_'))
    .sort();
  const problems = files.flatMap((file) =>
    scanJson(JSON.parse(readFileSync(join(folder, file), 'utf8')) as unknown).map((p) => `${relative(folder, join(folder, file))} ${p}`),
  );
  return { files: files.length, problems };
}

if (import.meta.main) {
  const folder = process.argv[2];
  if (!folder) throw new Error('usage: node test/helpers/fixture-scan.ts <folder>');
  const { files, problems } = scanFolder(folder);
  for (const problem of problems) console.log(problem);
  console.log(`${files} file(s) scanned, ${problems.length} problem(s)`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
