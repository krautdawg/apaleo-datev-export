import { z } from 'zod';
import { isLocalDate } from '../../core/date.js';
import { REPORT_PROBLEM_HINT } from '../../core/errors.js';
import { ApaleoError } from './errors.js';

/**
 * Response schemas mirroring the apaleo Swagger models (finance-v1, inventory-v1)
 * as far as this tool reads them. Enum fields (`type`, `command`, ...) are plain
 * strings so that a value apaleo adds later surfaces as an unmapped account, not
 * as a parser crash. Unknown fields are ignored.
 */

const text = z.string().min(1, 'must not be empty');
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? undefined);

/** ISO 8601 with any number of fractional digits; kept as the original string. */
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i, 'must be an ISO 8601 timestamp');

const localDate = z.string().refine(isLocalDate, 'must be a date written YYYY-MM-DD');

/** ExportAccountModel */
export const exportAccount = z.object({
  number: text,
  name: text,
  type: text,
  parentNumber: nullable(z.string()),
});

/** TaxAmountModel */
const taxAmount = z.object({ type: text, percent: z.number(), amount: z.number() });

/** ExportGrossTransactionItemModel */
export const exportTransaction = z.object({
  timestamp,
  date: localDate,
  debitedAccount: exportAccount,
  creditedAccount: exportAccount,
  command: text,
  currency: text,
  grossAmount: z.number(),
  netAmount: z.number(),
  taxes: nullable(z.array(taxAmount)),
  receipt: z.object({ type: nullable(z.string()), number: text }),
  sourceEntryNumber: text,
  reference: z.string(),
  referenceType: text,
});

/** ExportGrossTransactionListModel */
export const exportTransactionList = z.object({ transactions: z.array(exportTransaction) });

export interface SlimFinanceAccount {
  accountNumber: string;
  name: string;
  type: string;
  parentNumber?: string | undefined;
  hasChildren: boolean;
  isArchived: boolean;
  vat?: { type: string; percent: number } | undefined;
  subAccounts?: SlimFinanceAccount[] | undefined;
}

/** SlimFinanceAccountModel (recursive through subAccounts) */
const slimAccount: z.ZodType<SlimFinanceAccount, unknown> = z.lazy(() =>
  z.object({
    accountNumber: text,
    name: text,
    type: text,
    parentNumber: nullable(z.string()),
    hasChildren: z.boolean(),
    isArchived: z.boolean(),
    vat: nullable(z.object({ type: text, percent: z.number() })),
    subAccounts: nullable(z.array(slimAccount)),
  }),
);

/** ChartOfAccountsModel */
export const chartOfAccounts = z.object({
  globalAccounts: z.array(slimAccount),
  guestAccounts: z.array(slimAccount),
  externalAccounts: z.array(slimAccount),
  bookingAccounts: z.array(slimAccount),
});

/** PreciseMonetaryValueModel */
const preciseAmount = z.object({ amount: z.number(), currency: text });

const amounts = { debitedAmount: preciseAmount, creditedAmount: preciseAmount, balance: preciseAmount };

/** AggregateTransactionListModel */
export const aggregateList = z.object({
  aggregations: z.array(z.object({ account: exportAccount, ...amounts })),
  total: z.object(amounts),
});

/** PropertyListModel (inventory-v1) */
export const propertyList = z.object({
  properties: z.array(
    z.object({
      id: text,
      code: z.string(),
      name: text,
      timeZone: text,
      currencyCode: text,
      location: nullable(z.object({ countryCode: z.string() })),
    }),
  ),
  count: z.number().int(),
});

const MAX_REPORTED_ISSUES = 10;

/** Validates a response and fails with the JSON path of each problem, for example `transactions[3].sourceEntryNumber`. */
export function parseResponse<T extends z.ZodType>(schema: T, json: unknown, what: string): z.output<T> {
  const result = schema.safeParse(json);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => `  - ${describeIssue(issue)}`);
  const more = result.error.issues.length - issues.length;
  if (more > 0) issues.push(`  - and ${more} more`);
  throw new ApaleoError(
    `apaleo sent a response that does not match its API description (${what}):\n${issues.join('\n')}\n${REPORT_PROBLEM_HINT}`,
  );
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = formatPath(issue.path) || '(response)';
  const missing = issue.code === 'invalid_type' && issue.message.endsWith('received undefined');
  return `${path}: ${missing ? 'is missing' : issue.message}`;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((segment, i) => (typeof segment === 'number' ? `[${segment}]` : `${i === 0 ? '' : '.'}${String(segment)}`))
    .join('');
}
