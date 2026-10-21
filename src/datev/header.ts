import { addOneYear, isLocalDate, previousDay, type LocalDate } from '../core/date.js';
import type { Finding } from '../core/findings.js';
import { FORMAT_VERSION } from './columns.js';
import { toCp1252Text, describe } from './cp1252.js';
import { formatYyyymmdd, quoteText, SEPARATOR } from './format.js';
import { labelOf } from './labels.js';
import type { ExtfHeader } from './types.js';

export const HEADER_DEFAULTS = {
  herkunft: 'RE',
  exportiertVon: 'apaleo-datev-export',
  festschreibung: 0,
  bezeichnung: '',
  diktatkuerzel: '',
} as const;

/** "Erzeugt am" is written in German local time, whatever the machine's time zone. */
export const DATEV_TIME_ZONE = 'Europe/Berlin';

type ResolvedHeader = Required<ExtfHeader>;
type HeaderKey = keyof ExtfHeader;

export interface HeaderFieldSpec {
  readonly name: string;
  /**
   * `Empty` positions are reserved by DATEV and always written as nothing.
   * Reserved positions whose DATEV expression is quoted (`^["]["]$`) are `Text`
   * fields with an empty value instead, so they are written as `""`.
   */
  readonly type: 'Text' | 'Number' | 'Date' | 'Empty';
  readonly maxLength?: number;
  /** The header property the value comes from, used to name findings. */
  readonly key?: HeaderKey;
  readonly value?: (header: ResolvedHeader) => string;
}

/** The 31 header fields of DATEV-Format version 700, every position written out. */
export const EXTF_HEADER_FIELDS: readonly HeaderFieldSpec[] = [
  { name: 'Kennzeichen', type: 'Text', value: () => 'EXTF' }, // 1
  { name: 'Versionsnummer', type: 'Number', value: () => '700' }, // 2
  { name: 'Formatkategorie', type: 'Number', value: () => '21' }, // 3
  { name: 'Formatname', type: 'Text', value: () => 'Buchungsstapel' }, // 4
  { name: 'Formatversion', type: 'Number', value: () => String(FORMAT_VERSION) }, // 5
  { name: 'Erzeugt am', type: 'Number', key: 'erzeugtAm', value: (h) => formatTimestamp(h.erzeugtAm) }, // 6
  { name: 'Importiert', type: 'Empty' }, // 7
  { name: 'Herkunft', type: 'Text', maxLength: 2, key: 'herkunft', value: (h) => h.herkunft }, // 8
  { name: 'Exportiert von', type: 'Text', maxLength: 25, key: 'exportiertVon', value: (h) => h.exportiertVon }, // 9
  { name: 'Importiert von', type: 'Text', maxLength: 25, value: () => '' }, // 10, expression ^["]\w{0,25}["]$
  { name: 'Beraternummer', type: 'Number', key: 'beraternummer', value: (h) => String(h.beraternummer) }, // 11
  { name: 'Mandantennummer', type: 'Number', key: 'mandantennummer', value: (h) => String(h.mandantennummer) }, // 12
  { name: 'WJ-Beginn', type: 'Date', key: 'wjBeginn', value: (h) => formatYyyymmdd(h.wjBeginn) }, // 13
  { name: 'Sachkontenlänge', type: 'Number', key: 'sachkontenlaenge', value: (h) => String(h.sachkontenlaenge) }, // 14
  { name: 'Datum vom', type: 'Date', key: 'datumVom', value: (h) => formatYyyymmdd(h.datumVom) }, // 15
  { name: 'Datum bis', type: 'Date', key: 'datumBis', value: (h) => formatYyyymmdd(h.datumBis) }, // 16
  { name: 'Bezeichnung', type: 'Text', maxLength: 30, key: 'bezeichnung', value: (h) => h.bezeichnung }, // 17
  { name: 'Diktatkürzel', type: 'Text', maxLength: 2, key: 'diktatkuerzel', value: (h) => h.diktatkuerzel }, // 18
  { name: 'Buchungstyp', type: 'Number', value: () => '1' }, // 19 Finanzbuchführung
  { name: 'Rechnungslegungszweck', type: 'Number', value: () => '0' }, // 20 unabhängig
  { name: 'Festschreibung', type: 'Number', key: 'festschreibung', value: (h) => String(h.festschreibung) }, // 21
  { name: 'WKZ', type: 'Text', value: () => 'EUR' }, // 22
  { name: 'reserviert', type: 'Empty' }, // 23
  { name: 'Derivatskennzeichen', type: 'Text', value: () => '' }, // 24, expression ^["]["]$
  { name: 'reserviert', type: 'Empty' }, // 25
  { name: 'reserviert', type: 'Empty' }, // 26
  { name: 'Sachkontenrahmen', type: 'Text', key: 'sachkontenrahmen', value: (h) => h.sachkontenrahmen }, // 27
  { name: 'Branchenlösungs-ID', type: 'Empty' }, // 28
  { name: 'reserviert', type: 'Empty' }, // 29
  { name: 'reserviert', type: 'Text', value: () => '' }, // 30, expression ^["]["]$
  { name: 'Anwendungsinformation', type: 'Text', maxLength: 16, value: () => '' }, // 31
];

export function resolveHeader(header: ExtfHeader): ResolvedHeader {
  return { ...HEADER_DEFAULTS, ...header };
}

/**
 * Line 1 of the file. Text fields are quoted (an empty text field is `""`),
 * numbers and dates are not, reserved positions are empty. Characters outside
 * CP1252 are replaced with a `W-EXTF-CHARSET` warning.
 */
export function renderHeaderLine(header: ExtfHeader): { line: string; warnings: Finding[] } {
  const resolved = resolveHeader(header);
  const warnings: Finding[] = [];
  const fields = EXTF_HEADER_FIELDS.map((spec) => {
    if (spec.type === 'Empty' || !spec.value) return '';
    const raw = spec.value(resolved);
    if (spec.type !== 'Text') return raw;
    const { text, replaced } = toCp1252Text(raw);
    if (replaced.length > 0) {
      warnings.push({
        code: 'W-EXTF-CHARSET',
        message: `${replaced.map(describe).join(', ')} not in Windows-1252, written as "${text}"`,
        ...(spec.key ? { field: spec.key, label: labelOf(spec.key) } : {}),
        value: raw,
      });
    }
    return quoteText(text);
  });
  return { line: fields.join(SEPARATOR), warnings };
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * All header problems at once; an empty list means the header is valid. Text
 * fields with control characters (a line break or tab, for example from a config
 * file) are rejected, because they would split or shift the header line.
 */
export function validateHeader(header: ExtfHeader): Finding[] {
  const h = resolveHeader(header);
  const findings: Finding[] = [];
  const invalid = (field: HeaderKey, value: unknown, message: string) =>
    findings.push({ code: 'E-EXTF-HEADER', field, label: labelOf(field), value: String(value), message: `${labelOf(field)} ${message}` });

  const ranges: [HeaderKey, number, number, number][] = [
    ['beraternummer', h.beraternummer, 1001, 9_999_999],
    ['mandantennummer', h.mandantennummer, 1, 99_999],
    ['sachkontenlaenge', h.sachkontenlaenge, 4, 8],
  ];
  for (const [field, value, min, max] of ranges) {
    if (!Number.isInteger(value) || value < min || value > max) {
      invalid(field, value, `must be a whole number in the range ${min}–${max}, got ${value}`);
    }
  }

  const dates = (['wjBeginn', 'datumVom', 'datumBis'] as const).filter((field) => {
    const ok = isLocalDate(h[field]);
    if (!ok) invalid(field, h[field], `must be a valid date written YYYY-MM-DD, got "${h[field]}"`);
    return ok;
  });
  if (dates.length === 3) findings.push(...validatePeriod(h.wjBeginn, h.datumVom, h.datumBis));

  const texts: [HeaderKey, string, number][] = [
    ['bezeichnung', h.bezeichnung, 30],
    ['herkunft', h.herkunft, 2],
    ['exportiertVon', h.exportiertVon, 25],
  ];
  for (const [field, value, max] of texts) {
    if (CONTROL_CHARS.test(value)) {
      invalid(field, value, `must not contain line breaks, tabs or other control characters, got ${JSON.stringify(value)}`);
      continue;
    }
    const length = [...value.normalize('NFC')].length;
    if (length > max) invalid(field, value, `must be at most ${max} characters, got ${length}`);
  }
  if (!/^([A-Z]{2})?$/.test(h.diktatkuerzel)) {
    invalid('diktatkuerzel', h.diktatkuerzel, `must be two capital letters or empty, got ${JSON.stringify(h.diktatkuerzel)}`);
  }
  if (h.festschreibung !== 0 && h.festschreibung !== 1) {
    invalid('festschreibung', h.festschreibung, `must be 0 or 1, got ${String(h.festschreibung)}`);
  }
  if (!/^\d{2}$/.test(h.sachkontenrahmen)) {
    invalid('sachkontenrahmen', h.sachkontenrahmen, `must be two digits such as "03" or "04", got ${JSON.stringify(h.sachkontenrahmen)}`);
  }
  if (!(h.erzeugtAm instanceof Date) || Number.isNaN(h.erzeugtAm.getTime())) {
    invalid('erzeugtAm', h.erzeugtAm, 'must be a valid point in time');
  }
  return findings;
}

function validatePeriod(wjBeginn: LocalDate, datumVom: LocalDate, datumBis: LocalDate): Finding[] {
  const period = `${datumVom} to ${datumBis}`;
  if (datumVom > datumBis) {
    return [
      {
        code: 'E-EXTF-PERIOD',
        field: 'datumVom',
        label: labelOf('datumVom'),
        value: period,
        message: `Datum vom ${datumVom} is after Datum bis ${datumBis}`,
      },
    ];
  }
  const fiscalYearEnd = previousDay(addOneYear(wjBeginn));
  if (datumVom < wjBeginn || datumBis > fiscalYearEnd) {
    return [
      {
        code: 'E-EXTF-PERIOD',
        field: 'datumBis',
        label: labelOf('datumBis'),
        value: period,
        message: `the period ${period} must stay inside one fiscal year; WJ-Beginn ${wjBeginn} gives the fiscal year ${wjBeginn} to ${fiscalYearEnd}`,
      },
    ];
  }
  return [];
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: DATEV_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});

/** "Erzeugt am" as `YYYYMMDDHHMMSSFFF` in German local time. */
export function formatTimestamp(at: Date): string {
  const p = Object.fromEntries(TIMESTAMP_FORMAT.formatToParts(at).map(({ type, value }) => [type, value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}${p.fractionalSecond}`;
}
