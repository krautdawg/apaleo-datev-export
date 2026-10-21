import { ConfigNotFoundError, EXAMPLE_CONFIG_FILE, loadConfig, resolveConfigPath } from '../../core/config.js';
import { CONFIG_OPTION, EXIT_OK, stringOption, type Command } from '../command.js';
import { VERSION } from '../version.js';

export const doctor: Command = {
  name: 'doctor',
  summary: 'Check the setup: Node.js version, config file and clock (no network)',
  usage: '[--config <path>]',
  options: { ...CONFIG_OPTION },
  async run(args, ctx) {
    const path = resolveConfigPath(stringOption(args.values, 'config'), ctx.env, ctx.cwd);
    const print = (label: string, value: string) => ctx.stdout.write(`${`${label}:`.padEnd(15)}${value}\n`);

    print('apaleo-datev', VERSION);
    print('Node.js', process.version);
    print('Clock', ctx.now().toISOString());
    print('Config file', path);

    try {
      const loaded = await loadConfig({ path, env: ctx.env, readFile: ctx.fs.readFile });
      print('Config', 'valid');
      print('Client id', loaded.config.apaleo.clientId ? 'set' : 'not set (apaleo.clientId or APALEO_CLIENT_ID)');
      print('Client secret', loaded.secrets.apaleoClientSecret ? 'set (APALEO_CLIENT_SECRET)' : 'not set (APALEO_CLIENT_SECRET)');
    } catch (error) {
      if (!(error instanceof ConfigNotFoundError)) throw error;
      print('Config', `not found (copy ${EXAMPLE_CONFIG_FILE} to get started)`);
    }
    return EXIT_OK;
  },
};
