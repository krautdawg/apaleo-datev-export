import { loadConfig, resolveConfigPath, type LoadedConfig } from '../core/config.js';
import type { SourceAdapter } from '../core/source.js';
import { createApaleoSource } from '../sources/apaleo/index.js';
import { stringOption, type OptionValues } from './command.js';
import type { CommandContext } from './context.js';

/** Loads the config named by `--config`, `APALEO_DATEV_CONFIG` or the default file. */
export async function loadCommandConfig(values: OptionValues, ctx: CommandContext): Promise<LoadedConfig> {
  const path = resolveConfigPath(stringOption(values, 'config'), ctx.env, ctx.cwd);
  return loadConfig({ path, env: ctx.env, readFile: ctx.fs.readFile });
}

/** The source for a command: `ctx.sourceFactory` when set (tests, demo), else apaleo. */
export function createSource(loaded: LoadedConfig, ctx: CommandContext): SourceAdapter {
  return ctx.sourceFactory ? ctx.sourceFactory(loaded, ctx) : createApaleoSource(loaded, ctx);
}
