import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ChartIndex } from '../core/chart.js';
import type { Finding } from '../core/findings.js';
import { ACCOUNT_TYPES, type SourceAccount } from '../core/source.js';
import { commentLines, detectSeparator, parseCsv } from './csv.js';
import { PERSONAL_ACCOUNT_TYPE, WILDCARD, parsePercent, rowKey, type MappingRowValues, type Skr } from './types.js';

/**
 * The SKR03 and SKR04 hotel templates: rule files in `templates/` that
 * `init-mapping` applies to the apaleo chart of accounts.
 */

const RULE_COLUMNS = ['apaleo_type', 'name_pattern', 'apaleo_vat_percent', 'datev_account', 'bu_key', 'datev_vat_percent', 'comment'];
const TEMPLATE_ID = /\bskr0[34]-hotel@\d+\b/;
/** `name_pattern` of a rule that matches any name and also yields a wildcard row. */
const WILDCARD_PATTERN = '*';
const NO_RULE_COMMENT = 'Keine Vorlage-Regel passt: bitte mit Steuerberater zuordnen.';
const ARCHIVED = 'archiviert';
/** VAT rates the German templates know: 7 and 19 % today, 5 and 16 % from 1 July to 31 December 2020. */
export const GERMAN_VAT_RATES: readonly number[] = [5, 7, 16, 19];
/** The 2020 rates: the templates leave their revenue and deposit rows empty on purpose. */
export const HISTORICAL_VAT_RATES: readonly number[] = [5, 16];
const HISTORICAL_TYPES: ReadonlySet<string> = new Set(['Revenues', 'Liabilities']);

export interface TemplateRule {
  line: number;
  apaleoType: string;
  /** Undefined matches any name. */
  namePattern: RegExp | undefined;
  /** Also write a wildcard row (`*`) for the type and rate. */
  wildcard: boolean;
  /** Undefined matches any rate. */
  apaleoVatPercent: number | undefined;
  /** 4-digit base number (5 digits for personal accounts); empty leaves the account unmapped. */
  datevAccount: string;
  buKey: string;
  datevVatPercent: string;
  comment: string;
}

export interface Template {
  /** For example `skr03-hotel@1`. */
  id: string;
  skr: Skr;
  rules: TemplateRule[];
}

export function templateUrl(skr: Skr): URL {
  return new URL(`../../templates/skr${skr}-hotel.rules.csv`, import.meta.url);
}

/** Reads the template shipped in `templates/`. */
export async function loadTemplate(skr: Skr): Promise<Template> {
  return parseTemplate(await readFile(templateUrl(skr), 'utf8'), skr);
}

const shipped = new Map<Skr, Template>();

/** The template shipped in `templates/`, read once and synchronously (for fix hints in findings). */
export function shippedTemplate(skr: Skr): Template {
  let template = shipped.get(skr);
  if (!template) {
    template = parseTemplate(readFileSync(templateUrl(skr), 'utf8'), skr);
    shipped.set(skr, template);
  }
  return template;
}

/** The DATEV account the template's wildcard rule gives a type at a rate (any rate for types without one), scaled; undefined when none. */
export function templateWildcardAccount(template: Template, type: string, rate: number | undefined, sachkontenlaenge: number): string | undefined {
  const rule = template.rules.find(
    (r) => r.wildcard && r.apaleoType === type && r.datevAccount !== '' && (r.apaleoVatPercent === undefined || r.apaleoVatPercent === rate),
  );
  return rule ? scaleAccount(rule.datevAccount, type, sachkontenlaenge) : undefined;
}

export function parseTemplate(text: string, skr: Skr): Template {
  const id = TEMPLATE_ID.exec(commentLines(text).join('\n'))?.[0];
  if (!id?.startsWith(`skr${skr}-`)) throw new Error(`The SKR ${skr} template does not name its version (skr${skr}-hotel@N)`);
  const [header, ...records] = parseCsv(text, detectSeparator(text), `the SKR ${skr} template`);
  if (header?.fields.join(';') !== RULE_COLUMNS.join(';')) {
    throw new Error(`The SKR ${skr} template header must be ${RULE_COLUMNS.join(';')}`);
  }
  const rules = records.map(({ line, fields }): TemplateRule => {
    const [type = '', pattern = '', vat = '', datevAccount = '', buKey = '', datevVatPercent = '', comment = ''] = fields;
    return {
      line,
      apaleoType: type,
      namePattern: pattern === '' || pattern === WILDCARD_PATTERN ? undefined : new RegExp(pattern, 'iu'),
      wildcard: pattern === WILDCARD_PATTERN,
      apaleoVatPercent: parsePercent(vat),
      datevAccount,
      buKey,
      datevVatPercent,
      comment,
    };
  });
  return { id, skr, rules };
}

/** The first rule for the account's type and rate whose pattern matches its name or a parent's name. */
export function matchRule(template: Template, account: SourceAccount, names: readonly string[]): TemplateRule | undefined {
  return template.rules.find(
    (rule) =>
      rule.apaleoType === account.type &&
      (rule.apaleoVatPercent === undefined || rule.apaleoVatPercent === account.vat?.percent) &&
      (rule.namePattern === undefined || names.some((name) => rule.namePattern?.test(name))),
  );
}

/**
 * Scales a template number to the Sachkontenlänge by appending zeros: a G/L
 * account to L digits (8300 → 83000 at L = 5), a personal account to L + 1
 * (10000 → 100000).
 */
export function scaleAccount(account: string, apaleoType: string, sachkontenlaenge: number): string {
  if (account === '') return account;
  const extra = sachkontenlaenge - 4;
  return account + '0'.repeat(apaleoType === PERSONAL_ACCOUNT_TYPE ? extra : Math.max(extra, 0));
}

export interface Suggestion {
  rows: MappingRowValues[];
  /** `N-TEMPLATE-SCALED` when the template numbers were scaled. */
  findings: Finding[];
}

/** A row the template leaves empty on purpose: revenue or deposits at a 2020 rate (5 or 16 %). */
export function isHistoricalRow(row: Pick<MappingRowValues, 'apaleoType' | 'apaleoVatPercent' | 'datevAccount'>): boolean {
  const rate = parsePercent(row.apaleoVatPercent);
  return row.datevAccount === '' && HISTORICAL_TYPES.has(row.apaleoType) && rate !== undefined && HISTORICAL_VAT_RATES.includes(rate);
}

/**
 * One row per leaf account of the chart (an account without children of the
 * same type), pre-filled from the first matching rule, plus the wildcard rows of
 * the template. Accounts no rule matches stay unmapped. Rows are grouped by type.
 *
 * A container account outside the global ledger (`hasChildren`, such as
 * `3000` Liabilities) gets no row when its type has wildcard rules and no rule
 * gives it a DATEV account: the wildcard rows cover its per-reservation
 * children, and one DATEV account cannot serve every rate.
 */
export function suggestRows(accounts: readonly SourceAccount[], template: Template, sachkontenlaenge: number): Suggestion {
  const chart = new ChartIndex(accounts);
  const parents = new Set(accounts.flatMap((a) => (a.parentNumber === undefined ? [] : [`${a.parentNumber}\u0000${a.type}`])));
  const wildcardTypes = new Set(template.rules.filter((rule) => rule.wildcard).map((rule) => rule.apaleoType));
  const rows = new Map<string, MappingRowValues>();
  const add = (row: MappingRowValues) => {
    const key = rowKey(row);
    if (!rows.has(key)) rows.set(key, row);
  };

  for (const account of chart.accounts) {
    if (parents.has(`${account.number}\u0000${account.type}`)) continue;
    const rule = matchRule(template, account, [account.name, ...parentNames(chart, account)]);
    const container = account.ledger !== 'global' && account.hasChildren && wildcardTypes.has(account.type);
    if (container && !rule?.datevAccount) continue;
    const comment = rule?.comment ?? NO_RULE_COMMENT;
    add({
      apaleoAccount: account.number,
      apaleoType: account.type,
      apaleoName: account.name,
      apaleoVatPercent: account.vat === undefined ? '' : String(account.vat.percent),
      ...ruleValues(rule, account.type, sachkontenlaenge),
      comment: account.isArchived ? `${ARCHIVED}. ${comment}` : comment,
    });
  }
  for (const rule of template.rules.filter((r) => r.wildcard)) {
    add({
      apaleoAccount: WILDCARD,
      apaleoType: rule.apaleoType,
      apaleoName: '',
      apaleoVatPercent: rule.apaleoVatPercent === undefined ? '' : String(rule.apaleoVatPercent),
      ...ruleValues(rule, rule.apaleoType, sachkontenlaenge),
      comment: rule.comment,
    });
  }

  const findings: Finding[] = [];
  if (sachkontenlaenge !== 4) {
    findings.push({
      code: 'N-TEMPLATE-SCALED',
      message:
        `template account numbers were scaled to Sachkontenlänge ${sachkontenlaenge} by appending zeros ` +
        `(for example ${scaleAccount('8300', 'Revenues', sachkontenlaenge)} and ${scaleAccount('10000', PERSONAL_ACCOUNT_TYPE, sachkontenlaenge)})`,
    });
  }
  const foreign = foreignRates(accounts);
  if (foreign.length > 0) {
    findings.push({
      code: 'N-FOREIGN-VAT-RATES',
      message:
        `the chart has VAT rates the German templates and DATEV's Automatikkonten do not cover: ${foreign.map((rate) => `${rate} %`).join(', ')}. ` +
        'Their rows stay empty. An Austrian property needs an Austrian target such as BMD, not this DATEV export',
      value: foreign.join(','),
    });
  }
  return { rows: [...rows.values()].sort(byType), findings };
}

/** Positive VAT rates of the chart outside 5, 7, 16 and 19 %, in ascending order. */
function foreignRates(accounts: readonly SourceAccount[]): number[] {
  const rates = new Set(accounts.flatMap((a) => (a.vat && a.vat.percent > 0 && !GERMAN_VAT_RATES.includes(a.vat.percent) ? [a.vat.percent] : [])));
  return [...rates].sort((a, b) => a - b);
}

function ruleValues(rule: TemplateRule | undefined, type: string, sachkontenlaenge: number) {
  return {
    datevAccount: scaleAccount(rule?.datevAccount ?? '', type, sachkontenlaenge),
    buKey: rule?.buKey ?? '',
    datevVatPercent: rule?.datevAccount ? rule.datevVatPercent : '',
    kost1: '',
    kost2: '',
  };
}

function parentNames(chart: ChartIndex, account: SourceAccount): string[] {
  const names: string[] = [];
  const seen = new Set<string>([account.number]);
  let parent = account.parentNumber;
  while (parent !== undefined && !seen.has(parent)) {
    seen.add(parent);
    const found = chart.find(parent, account.type);
    if (!found) break;
    names.push(found.name);
    parent = found.parentNumber;
  }
  return names;
}

const TYPE_ORDER: readonly string[] = ACCOUNT_TYPES;

/** Known types in apaleo's order, unknown ones after them; within a type, chart order with wildcards last. */
function byType(a: MappingRowValues, b: MappingRowValues): number {
  const rank = (row: MappingRowValues) => {
    const index = TYPE_ORDER.indexOf(row.apaleoType);
    return index === -1 ? TYPE_ORDER.length : index;
  };
  return rank(a) - rank(b) || Number(a.apaleoAccount === WILDCARD) - Number(b.apaleoAccount === WILDCARD);
}
