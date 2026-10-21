/**
 * The names DATEV and the Steuerberater use for each field, so findings never
 * show internal property names such as `amountCents` to the user.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  // Booking fields
  amountCents: 'Umsatz',
  side: 'Soll/Haben-Kennzeichen',
  konto: 'Konto',
  gegenkonto: 'Gegenkonto',
  buKey: 'BU-Schlüssel',
  belegdatum: 'Belegdatum',
  belegfeld1: 'Belegfeld 1',
  belegfeld2: 'Belegfeld 2',
  buchungstext: 'Buchungstext',
  kost1: 'KOST1',
  kost2: 'KOST2',
  // Header fields
  erzeugtAm: 'Erzeugt am',
  herkunft: 'Herkunft',
  exportiertVon: 'Exportiert von',
  beraternummer: 'Beraternummer',
  mandantennummer: 'Mandantennummer',
  wjBeginn: 'WJ-Beginn',
  sachkontenlaenge: 'Sachkontenlänge',
  datumVom: 'Datum vom',
  datumBis: 'Datum bis',
  bezeichnung: 'Bezeichnung',
  diktatkuerzel: 'Diktatkürzel',
  festschreibung: 'Festschreibung',
  sachkontenrahmen: 'Sachkontenrahmen',
  // File
  suffix: 'File name suffix',
};

/** The DATEV name of a field, or the field name itself if none is known. */
export function labelOf(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
