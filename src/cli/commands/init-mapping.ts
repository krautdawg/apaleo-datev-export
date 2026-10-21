import { UsageError, UserError } from '../../core/errors.js';
import { formatFinding } from '../../core/findings.js';
import {
  VAT_ACCOUNT_TYPES,
  appendRows,
  convertGrmanRows,
  loadTemplate,
  mappingHeaderComment,
  newRows,
  parseMapping,
  renderMappingFile,
  suggestRows,
  type MappingRowValues,
} from '../../mapping/index.js';
import { CONFIG_OPTION, EXIT_OK, stringOption, type Command } from '../command.js';
import type { CommandContext } from '../context.js';
import { pathExists, readIfExists, replaceKeepingBackup, writeFileAtomic } from '../files.js';
import { SKR_OPTION, mappingPath, parseSkr } from '../mapping-file.js';
import { createSource, loadCommandConfig } from '../source.js';
import { formatTable } from '../table.js';

export const initMapping: Command = {
  name: 'init-mapping',
  summary: 'Write a mapping CSV for a property from its apaleo chart of accounts and the SKR03/SKR04 hotel template',
  usage: '--property <id> --skr 03|04 [--out <file>] [--update] [--config <path>]',
  options: {
    property: { type: 'string', valueName: '<id>', description: 'apaleo property id, for example BSP' },
    ...SKR_OPTION,
    out: { type: 'string', valueName: '<file>', description: 'Mapping file (default: properties[].mapping or ./mapping-<id>.csv)' },
    update: { type: 'boolean', description: 'Append rows for new apaleo accounts to an existing file; existing rows stay unchanged' },
    ...CONFIG_OPTION,
  },
  async run(args, ctx) {
    const propertyId = stringOption(args.values, 'property');
    if (!propertyId) throw new UsageError('init-mapping needs --property <id>. Run "apaleo-datev properties" to list them.');
    const skr = parseSkr(stringOption(args.values, 'skr'));
    if (!skr) throw new UsageError('init-mapping needs --skr 03 or --skr 04 (ask the Kanzlei which chart the Mandant uses).');
    const update = args.values.update === true;

    const loaded = await loadCommandConfig(args.values, ctx);
    const sachkontenlaenge = loaded.config.datev.sachkontenlaenge;
    const path = mappingPath(loaded, propertyId, stringOption(args.values, 'out'), ctx.cwd);
    const existing = await readIfExists(ctx, path);
    if (existing && !update) {
      throw new UserError(
        `${path} already exists and was not changed. Run again with --update to add new apaleo accounts to it, ` +
          'or choose another file with --out.',
      );
    }
    // Read the file before calling apaleo, so a broken file fails fast.
    const mapping = existing ? parseMapping(existing, { path, sachkontenlaenge }) : undefined;
    if (mapping?.skr && mapping.skr !== skr) {
      throw new UserError(`${path} was made from the SKR ${mapping.skr} template; run --update with --skr ${mapping.skr}.`);
    }
    const backup = path.replace(/(\.csv)?$/i, '.grman.csv');
    if (mapping?.layout === 'grman' && (await pathExists(ctx, backup))) {
      throw new UserError(
        `${path} is a Grman export, and converting it keeps the original as ${backup}, but that file already exists. ` +
          'Move or rename it and run again; nothing was changed.',
      );
    }

    const accounts = await createSource(loaded, ctx).getChartOfAccounts(propertyId);
    const template = await loadTemplate(skr);
    const suggestion = suggestRows(accounts, template, sachkontenlaenge);
    for (const finding of suggestion.findings) ctx.stdout.write(`${formatFinding(finding)}\n`);

    if (!existing || !mapping) {
      await writeFileAtomic(ctx, path, renderMappingFile([mappingHeaderComment(template, sachkontenlaenge)], suggestion.rows));
      ctx.stdout.write(`Wrote ${path} from template ${template.id} for property ${propertyId}.\n`);
      printCounts(ctx, suggestion.rows);
      ctx.stdout.write(
        'Every row is a suggestion: have your Steuerberater check the file, fill in the empty DATEV accounts, ' +
          'then run "apaleo-datev mapping check".\n',
      );
      return EXIT_OK;
    }

    if (mapping.layout === 'grman') {
      const converted = convertGrmanRows(mapping, accounts);
      const added = newRows(converted, suggestion.rows);
      const comment = mappingHeaderComment(template, sachkontenlaenge);
      await replaceKeepingBackup(ctx, path, backup, renderMappingFile([comment], [...converted, ...added]));
      ctx.stdout.write(
        `Converted the Grman export ${path} to the apaleo-datev layout (${converted.length} rows kept, the original is ${backup}).\n`,
      );
      printAdded(ctx, added);
      return EXIT_OK;
    }

    const added = newRows(mapping.rows, suggestion.rows);
    if (added.length === 0) {
      ctx.stdout.write(`No new apaleo accounts: ${path} is unchanged.\n`);
      return EXIT_OK;
    }
    await writeFileAtomic(ctx, path, appendRows(existing, added));
    ctx.stdout.write(`Updated ${path}: existing rows unchanged.\n`);
    printAdded(ctx, added);
    return EXIT_OK;
  },
};

function printCounts(ctx: CommandContext, rows: readonly MappingRowValues[]): void {
  const needed = rows.filter((row) => !VAT_ACCOUNT_TYPES.has(row.apaleoType));
  const mapped = needed.filter((row) => row.datevAccount !== '').length;
  const vatRows = rows.length - needed.length;
  ctx.stdout.write(
    `${rows.length} rows: ${mapped} mapped, ${needed.length - mapped} unmapped` +
      (vatRows > 0 ? `, ${vatRows} VAT account row(s) that need no DATEV account` : '') +
      '.\n',
  );
}

function printAdded(ctx: CommandContext, added: readonly MappingRowValues[]): void {
  if (added.length === 0) {
    ctx.stdout.write('No new apaleo accounts.\n');
    return;
  }
  ctx.stdout.write(`Added ${added.length} row(s) for new apaleo accounts:\n`);
  const rows = added.map((row) => [
    row.apaleoAccount,
    row.apaleoType,
    row.apaleoName,
    row.apaleoVatPercent === '' ? '' : `${row.apaleoVatPercent} %`,
    row.datevAccount || '(unmapped)',
  ]);
  ctx.stdout.write(formatTable(rows, [], '  '));
  printCounts(ctx, added);
}
