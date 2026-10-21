import type { CommandContext } from './context.js';

/** Exit codes scripts and cron can rely on. */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

/** One command line option, in `node:util` `parseArgs` form plus help text. */
export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  multiple?: boolean;
  description: string;
  /** Placeholder shown in help for string options, for example `<path>`. */
  valueName?: string;
}

export type OptionValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

export interface CommandArgs {
  values: OptionValues;
  positionals: string[];
}

export interface Command {
  name: string;
  summary: string;
  /** Usage after `apaleo-datev <name>`, for example `[--config <path>]`. */
  usage: string;
  options: Record<string, OptionSpec>;
  allowPositionals?: boolean;
  /** Returns the exit code (see `EXIT_OK`, `EXIT_FAILURE`). */
  run(args: CommandArgs, ctx: CommandContext): Promise<number>;
}

/** Options every command accepts. */
export const COMMON_OPTIONS: Record<string, OptionSpec> = {
  help: { type: 'boolean', short: 'h', description: 'Show help for this command' },
  debug: { type: 'boolean', description: 'Print stack traces on errors' },
};

/** The shared `--config` option for commands that read the config file. */
export const CONFIG_OPTION: Record<string, OptionSpec> = {
  config: {
    type: 'string',
    valueName: '<path>',
    description: 'Config file (default: $APALEO_DATEV_CONFIG or ./apaleo-datev.config.yaml)',
  },
};

export function stringOption(values: OptionValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}
