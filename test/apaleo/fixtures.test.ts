import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixturePath, readFixture } from '../helpers/apaleo.js';
import { validateSwagger, type SwaggerSchema } from '../helpers/swagger.js';

const excerpt = readFixture('swagger-excerpt.json') as { definitions: Record<string, SwaggerSchema> };
const definitions = excerpt.definitions;

/** Which Swagger model each fixture folder or file holds. Every fixture must be listed. */
const MODELS: [RegExp, string][] = [
  [/^export-gross-daily\/\d{4}-\d{2}-\d{2}\.json$/, 'ExportGrossTransactionListModel'],
  [/^aggregate-daily\/\d{4}-\d{2}-\d{2}\.json$/, 'AggregateTransactionListModel'],
  [/^accounts-schema\.json$/, 'ChartOfAccountsModel'],
  [/^properties\/page-\d+\.json$/, 'PropertyListModel'],
];

const fixtures = readdirSync(fileURLToPath(fixturePath('.')), { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.json') && file !== 'swagger-excerpt.json')
  .sort();

describe('apaleo fixtures conform to the Swagger excerpt', () => {
  it('has a model for every fixture file', () => {
    const unknown = fixtures.filter((file) => !MODELS.some(([pattern]) => pattern.test(file)));
    expect(unknown).toEqual([]);
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  it.each(fixtures)('%s', (file) => {
    const model = MODELS.find(([pattern]) => pattern.test(file))?.[1] as string;
    expect(validateSwagger(definitions, model, readFixture(file))).toEqual([]);
  });

  it('holds the models the adapter reads', () => {
    for (const model of [
      'ExportGrossTransactionItemModel',
      'ExportAccountModel',
      'TaxAmountModel',
      'ReceiptModel',
      'SlimFinanceAccountModel',
      'VatItemModel',
      'AggregateTransactionItemModel',
      'PreciseMonetaryValueModel',
      'PropertyItemModel',
    ]) {
      expect(definitions[model], model).toBeDefined();
    }
  });
});

describe('the Swagger validator catches drift', () => {
  const day = () => structuredClone(readFixture('export-gross-daily/2026-09-14.json')) as {
    transactions: Record<string, unknown>[];
  };

  it('reports a missing required field with its path', () => {
    const data = day();
    delete data.transactions[1]?.sourceEntryNumber;
    expect(validateSwagger(definitions, 'ExportGrossTransactionListModel', data)).toEqual([
      '$.transactions[1].sourceEntryNumber: is required',
    ]);
  });

  it('reports an enum value the Swagger does not list', () => {
    const data = day();
    (data.transactions[0] as { command: string }).command = 'PostMagic';
    (data.transactions[0] as { debitedAccount: { type: string } }).debitedAccount.type = 'Wallet';
    expect(validateSwagger(definitions, 'ExportGrossTransactionListModel', data)).toEqual([
      expect.stringMatching(/^\$\.transactions\[0\]\.debitedAccount\.type: "Wallet" is not one of /),
      expect.stringMatching(/^\$\.transactions\[0\]\.command: "PostMagic" is not one of /),
    ]);
  });

  it('reports wrong types, unknown fields and null where the model forbids it', () => {
    const data = day();
    const first = data.transactions[0] as Record<string, unknown>;
    first.grossAmount = '200.00';
    first.extra = 1;
    first.receipt = null;
    expect(validateSwagger(definitions, 'ExportGrossTransactionListModel', data)).toEqual([
      '$.transactions[0].grossAmount: must be a number',
      '$.transactions[0].receipt: must not be null',
      '$.transactions[0].extra: is not in the model',
    ]);
  });
});
