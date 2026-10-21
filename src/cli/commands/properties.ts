import { CONFIG_OPTION, EXIT_OK, type Command } from '../command.js';
import { createSource, loadCommandConfig } from '../source.js';
import { formatTable } from '../table.js';

export const properties: Command = {
  name: 'properties',
  summary: 'List the apaleo properties the custom app can read (id, code, name, time zone, currency)',
  usage: '[--config <path>]',
  options: { ...CONFIG_OPTION },
  async run(args, ctx) {
    const source = createSource(await loadCommandConfig(args.values, ctx), ctx);
    const list = await source.listProperties();
    if (list.length === 0) {
      ctx.stdout.write('No properties found. Check that the custom app has access to at least one property.\n');
      return EXIT_OK;
    }
    const rows = list.map((p) => [p.id, p.code, p.name, p.timeZone, p.currency]);
    ctx.stdout.write(formatTable([['ID', 'CODE', 'NAME', 'TIME ZONE', 'CURRENCY'], ...rows]));
    return EXIT_OK;
  },
};
