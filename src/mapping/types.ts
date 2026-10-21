import type { Finding } from '../core/findings.js';

/** The columns of a mapping CSV, in the order the tool writes them. */
export const MAPPING_COLUMNS = [
  'apaleo_account',
  'apaleo_type',
  'apaleo_name',
  'apaleo_vat_percent',
  'datev_account',
  'bu_key',
  'datev_vat_percent',
  'kost1',
  'kost2',
  'comment',
] as const;

export type MappingColumn = (typeof MAPPING_COLUMNS)[number];

/** The header of the Grman "Datev Connector" mapping export, read as the columns next to it. */
export const GRMAN_COLUMNS: Readonly<Record<string, MappingColumn>> = {
  apaleoaccountnumber: 'apaleo_account',
  datevaccountnumber: 'datev_account',
  costcenter: 'kost1',
  costcenter2: 'kost2',
};

/** `apaleo_account` of a row that matches every account of its type. */
export const WILDCARD = '*';

/** `apaleo_type` of a row that matches its account number regardless of type (Grman layout). */
export const ANY_TYPE = '*any*';

/**
 * Types whose lines carry VAT. A wildcard row for one of them must name the VAT
 * rate it stands for, so an account with an unknown rate never slips through.
 */
export const VAT_RELEVANT_TYPES: ReadonlySet<string> = new Set([
  'Liabilities',
  'CityTaxes',
  'SecondCityTax',
  'GuestLevies',
  'LossOfAccountsReceivable',
  'Vat',
  'VatOnLiabilities',
  'Revenues',
]);

/** apaleo's own VAT accounts. Their lines are always skipped (DATEV computes VAT), so they need no row. */
export const VAT_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['Vat', 'VatOnLiabilities']);

/** Personal (debtor) accounts: one digit longer than the Sachkontenlänge. */
export const PERSONAL_ACCOUNT_TYPE = 'AccountsReceivable';

export type Skr = '03' | '04';

/** One row of a mapping file. Every value is kept as the text in the file. */
export interface MappingRow {
  /** Line of the file the row ends on, 1-based. */
  readonly line: number;
  readonly apaleoAccount: string;
  readonly apaleoType: string;
  readonly apaleoName: string;
  readonly apaleoVatPercent: string;
  /** Empty means unmapped. */
  readonly datevAccount: string;
  readonly buKey: string;
  readonly datevVatPercent: string;
  readonly kost1: string;
  readonly kost2: string;
  readonly comment: string;
}

export type MappingRowValues = Omit<MappingRow, 'line'>;

export const ROW_FIELDS: Readonly<Record<MappingColumn, keyof MappingRowValues>> = {
  apaleo_account: 'apaleoAccount',
  apaleo_type: 'apaleoType',
  apaleo_name: 'apaleoName',
  apaleo_vat_percent: 'apaleoVatPercent',
  datev_account: 'datevAccount',
  bu_key: 'buKey',
  datev_vat_percent: 'datevVatPercent',
  kost1: 'kost1',
  kost2: 'kost2',
  comment: 'comment',
};

export interface Mapping {
  readonly path: string;
  /** `grman` for a file in the Grman connector's export layout. */
  readonly layout: 'standard' | 'grman';
  /** The SKR named by the template marker in the file's comment lines, if any. */
  readonly skr?: Skr;
  readonly rows: readonly MappingRow[];
  /** Notes and warnings from reading the file, for example restored leading zeros (`W-PADDED`). */
  readonly findings: readonly Finding[];
}

/**
 * A VAT percent as written in the file: `7`, `7,0`, `7.00` or `7 %`. Undefined
 * for an empty cell, NaN for anything else.
 */
export function parsePercent(text: string): number | undefined {
  const value = text.trim().replace(/\s*%$/, '').replace(',', '.');
  if (value === '') return undefined;
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

/** The key two rows must not share: account and type, plus the rate for wildcard rows of VAT-relevant types. */
export function rowKey(row: Pick<MappingRow, 'apaleoAccount' | 'apaleoType' | 'apaleoVatPercent'>): string {
  const base = `${row.apaleoAccount}\u0000${row.apaleoType}`;
  const rated = row.apaleoAccount === WILDCARD && VAT_RELEVANT_TYPES.has(row.apaleoType);
  return rated ? `${base}\u0000${parsePercent(row.apaleoVatPercent) ?? ''}` : base;
}

/** "line 7", for messages. */
export function lineLabel(row: Pick<MappingRow, 'line'>): string {
  return `line ${row.line}`;
}
