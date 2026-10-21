/**
 * Field types of the DATEV-Format. The type alone decides how a value is written:
 * `Text` is quoted with inner quotes doubled; the others are written as they are.
 */
export type FieldType = 'Text' | 'Number' | 'Amount' | 'Date' | 'Account';

export interface ColumnSpec {
  readonly name: string;
  readonly type: FieldType;
  readonly maxLength?: number;
}

export const FORMAT_VERSION = 13;

/**
 * The 125 Buchungsstapel columns of format version 13, in file order.
 *
 * Names are copied from the heading line of DATEV's sample file
 * (`EXTF_Buchungsstapel.csv` in "Musterdaten DATEV-Format", developer.datev.de,
 * file dated 2025-06-18); types and lengths from the field expressions in the
 * DATEV format description. The lengths of the fields this tool fills follow the
 * project design (Belegfeld 2: 12). See docs/datev-format.md.
 */
export const BUCHUNGSSTAPEL_COLUMNS = [
  { name: 'Umsatz (ohne Soll/Haben-Kz)', type: 'Amount' }, // 1
  { name: 'Soll/Haben-Kennzeichen', type: 'Text', maxLength: 1 }, // 2
  { name: 'WKZ Umsatz', type: 'Text', maxLength: 3 }, // 3
  { name: 'Kurs', type: 'Number' }, // 4
  { name: 'Basis-Umsatz', type: 'Amount' }, // 5
  { name: 'WKZ Basis-Umsatz', type: 'Text', maxLength: 3 }, // 6
  { name: 'Konto', type: 'Account' }, // 7
  { name: 'Gegenkonto (ohne BU-Schlüssel)', type: 'Account' }, // 8
  { name: 'BU-Schlüssel', type: 'Text', maxLength: 4 }, // 9
  { name: 'Belegdatum', type: 'Date' }, // 10
  { name: 'Belegfeld 1', type: 'Text', maxLength: 36 }, // 11
  { name: 'Belegfeld 2', type: 'Text', maxLength: 12 }, // 12
  { name: 'Skonto', type: 'Amount' }, // 13
  { name: 'Buchungstext', type: 'Text', maxLength: 60 }, // 14
  { name: 'Postensperre', type: 'Number' }, // 15
  { name: 'Diverse Adressnummer', type: 'Text', maxLength: 9 }, // 16
  { name: 'Geschäftspartnerbank', type: 'Number' }, // 17
  { name: 'Sachverhalt', type: 'Number' }, // 18
  { name: 'Zinssperre', type: 'Number' }, // 19
  { name: 'Beleglink', type: 'Text', maxLength: 210 }, // 20
  { name: 'Beleginfo - Art 1', type: 'Text', maxLength: 20 }, // 21
  { name: 'Beleginfo - Inhalt 1', type: 'Text', maxLength: 210 }, // 22
  { name: 'Beleginfo - Art 2', type: 'Text', maxLength: 20 }, // 23
  { name: 'Beleginfo - Inhalt 2', type: 'Text', maxLength: 210 }, // 24
  { name: 'Beleginfo - Art 3', type: 'Text', maxLength: 20 }, // 25
  { name: 'Beleginfo - Inhalt 3', type: 'Text', maxLength: 210 }, // 26
  { name: 'Beleginfo - Art 4', type: 'Text', maxLength: 20 }, // 27
  { name: 'Beleginfo - Inhalt 4', type: 'Text', maxLength: 210 }, // 28
  { name: 'Beleginfo - Art 5', type: 'Text', maxLength: 20 }, // 29
  { name: 'Beleginfo - Inhalt 5', type: 'Text', maxLength: 210 }, // 30
  { name: 'Beleginfo - Art 6', type: 'Text', maxLength: 20 }, // 31
  { name: 'Beleginfo - Inhalt 6', type: 'Text', maxLength: 210 }, // 32
  { name: 'Beleginfo - Art 7', type: 'Text', maxLength: 20 }, // 33
  { name: 'Beleginfo - Inhalt 7', type: 'Text', maxLength: 210 }, // 34
  { name: 'Beleginfo - Art 8', type: 'Text', maxLength: 20 }, // 35
  { name: 'Beleginfo - Inhalt 8', type: 'Text', maxLength: 210 }, // 36
  { name: 'KOST1 - Kostenstelle', type: 'Text', maxLength: 36 }, // 37
  { name: 'KOST2 - Kostenstelle', type: 'Text', maxLength: 36 }, // 38
  { name: 'Kost-Menge', type: 'Number' }, // 39
  { name: 'EU-Land u. UStID (Bestimmung)', type: 'Text', maxLength: 15 }, // 40
  { name: 'EU-Steuersatz (Bestimmung)', type: 'Number' }, // 41
  { name: 'Abw. Versteuerungsart', type: 'Text', maxLength: 1 }, // 42
  { name: 'Sachverhalt L+L', type: 'Number' }, // 43
  { name: 'Funktionsergänzung L+L', type: 'Number' }, // 44
  { name: 'BU 49 Hauptfunktionstyp', type: 'Number' }, // 45
  { name: 'BU 49 Hauptfunktionsnummer', type: 'Number' }, // 46
  { name: 'BU 49 Funktionsergänzung', type: 'Number' }, // 47
  { name: 'Zusatzinformation - Art 1', type: 'Text', maxLength: 20 }, // 48
  { name: 'Zusatzinformation- Inhalt 1', type: 'Text', maxLength: 210 }, // 49
  { name: 'Zusatzinformation - Art 2', type: 'Text', maxLength: 20 }, // 50
  { name: 'Zusatzinformation- Inhalt 2', type: 'Text', maxLength: 210 }, // 51
  { name: 'Zusatzinformation - Art 3', type: 'Text', maxLength: 20 }, // 52
  { name: 'Zusatzinformation- Inhalt 3', type: 'Text', maxLength: 210 }, // 53
  { name: 'Zusatzinformation - Art 4', type: 'Text', maxLength: 20 }, // 54
  { name: 'Zusatzinformation- Inhalt 4', type: 'Text', maxLength: 210 }, // 55
  { name: 'Zusatzinformation - Art 5', type: 'Text', maxLength: 20 }, // 56
  { name: 'Zusatzinformation- Inhalt 5', type: 'Text', maxLength: 210 }, // 57
  { name: 'Zusatzinformation - Art 6', type: 'Text', maxLength: 20 }, // 58
  { name: 'Zusatzinformation- Inhalt 6', type: 'Text', maxLength: 210 }, // 59
  { name: 'Zusatzinformation - Art 7', type: 'Text', maxLength: 20 }, // 60
  { name: 'Zusatzinformation- Inhalt 7', type: 'Text', maxLength: 210 }, // 61
  { name: 'Zusatzinformation - Art 8', type: 'Text', maxLength: 20 }, // 62
  { name: 'Zusatzinformation- Inhalt 8', type: 'Text', maxLength: 210 }, // 63
  { name: 'Zusatzinformation - Art 9', type: 'Text', maxLength: 20 }, // 64
  { name: 'Zusatzinformation- Inhalt 9', type: 'Text', maxLength: 210 }, // 65
  { name: 'Zusatzinformation - Art 10', type: 'Text', maxLength: 20 }, // 66
  { name: 'Zusatzinformation- Inhalt 10', type: 'Text', maxLength: 210 }, // 67
  { name: 'Zusatzinformation - Art 11', type: 'Text', maxLength: 20 }, // 68
  { name: 'Zusatzinformation- Inhalt 11', type: 'Text', maxLength: 210 }, // 69
  { name: 'Zusatzinformation - Art 12', type: 'Text', maxLength: 20 }, // 70
  { name: 'Zusatzinformation- Inhalt 12', type: 'Text', maxLength: 210 }, // 71
  { name: 'Zusatzinformation - Art 13', type: 'Text', maxLength: 20 }, // 72
  { name: 'Zusatzinformation- Inhalt 13', type: 'Text', maxLength: 210 }, // 73
  { name: 'Zusatzinformation - Art 14', type: 'Text', maxLength: 20 }, // 74
  { name: 'Zusatzinformation- Inhalt 14', type: 'Text', maxLength: 210 }, // 75
  { name: 'Zusatzinformation - Art 15', type: 'Text', maxLength: 20 }, // 76
  { name: 'Zusatzinformation- Inhalt 15', type: 'Text', maxLength: 210 }, // 77
  { name: 'Zusatzinformation - Art 16', type: 'Text', maxLength: 20 }, // 78
  { name: 'Zusatzinformation- Inhalt 16', type: 'Text', maxLength: 210 }, // 79
  { name: 'Zusatzinformation - Art 17', type: 'Text', maxLength: 20 }, // 80
  { name: 'Zusatzinformation- Inhalt 17', type: 'Text', maxLength: 210 }, // 81
  { name: 'Zusatzinformation - Art 18', type: 'Text', maxLength: 20 }, // 82
  { name: 'Zusatzinformation- Inhalt 18', type: 'Text', maxLength: 210 }, // 83
  { name: 'Zusatzinformation - Art 19', type: 'Text', maxLength: 20 }, // 84
  { name: 'Zusatzinformation- Inhalt 19', type: 'Text', maxLength: 210 }, // 85
  { name: 'Zusatzinformation - Art 20', type: 'Text', maxLength: 20 }, // 86
  { name: 'Zusatzinformation- Inhalt 20', type: 'Text', maxLength: 210 }, // 87
  { name: 'Stück', type: 'Number' }, // 88
  { name: 'Gewicht', type: 'Number' }, // 89
  { name: 'Zahlweise', type: 'Number' }, // 90
  { name: 'Forderungsart', type: 'Text', maxLength: 10 }, // 91
  { name: 'Veranlagungsjahr', type: 'Number' }, // 92
  { name: 'Zugeordnete Fälligkeit', type: 'Date' }, // 93
  { name: 'Skontotyp', type: 'Number' }, // 94
  { name: 'Auftragsnummer', type: 'Text', maxLength: 30 }, // 95
  { name: 'Buchungstyp', type: 'Text', maxLength: 2 }, // 96
  { name: 'USt-Schlüssel (Anzahlungen)', type: 'Number' }, // 97
  { name: 'EU-Land (Anzahlungen)', type: 'Text', maxLength: 2 }, // 98
  { name: 'Sachverhalt L+L (Anzahlungen)', type: 'Number' }, // 99
  { name: 'EU-Steuersatz (Anzahlungen)', type: 'Number' }, // 100
  { name: 'Erlöskonto (Anzahlungen)', type: 'Account' }, // 101
  { name: 'Herkunft-Kz', type: 'Text', maxLength: 2 }, // 102
  { name: 'Buchungs GUID', type: 'Text', maxLength: 36 }, // 103
  { name: 'KOST-Datum', type: 'Date' }, // 104
  { name: 'SEPA-Mandatsreferenz', type: 'Text', maxLength: 35 }, // 105
  { name: 'Skontosperre', type: 'Number' }, // 106
  { name: 'Gesellschaftername', type: 'Text', maxLength: 76 }, // 107
  { name: 'Beteiligtennummer', type: 'Number' }, // 108
  { name: 'Identifikationsnummer', type: 'Text', maxLength: 11 }, // 109
  { name: 'Zeichnernummer', type: 'Text', maxLength: 20 }, // 110
  { name: 'Postensperre bis', type: 'Date' }, // 111
  { name: 'Bezeichnung SoBil-Sachverhalt', type: 'Text', maxLength: 30 }, // 112
  { name: 'Kennzeichen SoBil-Buchung', type: 'Number' }, // 113
  { name: 'Festschreibung', type: 'Number' }, // 114
  { name: 'Leistungsdatum', type: 'Date' }, // 115
  { name: 'Datum Zuord. Steuerperiode', type: 'Date' }, // 116
  { name: 'Fälligkeit', type: 'Date' }, // 117
  { name: 'Generalumkehr (GU)', type: 'Text', maxLength: 1 }, // 118
  { name: 'Steuersatz', type: 'Number' }, // 119
  { name: 'Land', type: 'Text', maxLength: 2 }, // 120
  { name: 'Abrechnungsreferenz', type: 'Text', maxLength: 50 }, // 121
  { name: 'BVV-Position', type: 'Number' }, // 122
  { name: 'EU-Land u. UStID (Ursprung)', type: 'Text', maxLength: 15 }, // 123
  { name: 'EU-Steuersatz (Ursprung)', type: 'Number' }, // 124
  { name: 'Abw. Skontokonto', type: 'Account' }, // 125
] as const satisfies readonly ColumnSpec[];

/** 1-based positions of the columns this tool fills. */
export const COLUMN = {
  umsatz: 1,
  sollHaben: 2,
  konto: 7,
  gegenkonto: 8,
  buKey: 9,
  belegdatum: 10,
  belegfeld1: 11,
  belegfeld2: 12,
  buchungstext: 14,
  kost1: 37,
  kost2: 38,
  /** Repeats the header's Festschreibung: DATEV locks a line whose field 114 is empty. */
  festschreibung: 114,
} as const;

export type FilledField = keyof typeof COLUMN;

export function columnAt(position: number): ColumnSpec {
  const column: ColumnSpec | undefined = BUCHUNGSSTAPEL_COLUMNS[position - 1];
  if (!column) throw new RangeError(`No Buchungsstapel column ${position}`);
  return column;
}

/** Maximum length of a filled Text column, from the column list. */
export function maxLengthOf(field: FilledField): number {
  const { maxLength } = columnAt(COLUMN[field]);
  if (maxLength === undefined) throw new RangeError(`Column ${field} has no maximum length`);
  return maxLength;
}
