# src/mapping

Account mapping: the editable CSV from apaleo accounts to DATEV accounts. PMS-neutral; must not import from `src/sources/` (enforced by lint).

- `load.ts` reads a mapping file (UTF-8 or CP1252, `;` or `,`, our layout or the Grman export) and rejects duplicate keys and forbidden wildcards.
- `resolve.ts` finds the row for one side of a ledger line (exact, any type, parent chain, rate wildcard, plain wildcard).
- `check.ts` validates rows (`checkMapping`) and the accounts booked in a period (`checkCoverage`, `E-UNMAPPED`).
- `template.ts` applies the SKR03/SKR04 hotel rules in `templates/` to a chart of accounts.
- `file.ts` writes mapping files and appends rows for `init-mapping --update`.
