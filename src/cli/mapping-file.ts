import { resolve } from 'node:path';
import type { LoadedConfig } from '../core/config.js';
import { UsageError } from '../core/errors.js';
import type { Skr } from '../mapping/index.js';
import type { OptionSpec } from './command.js';

export const SKR_OPTION: Record<string, OptionSpec> = {
  skr: { type: 'string', valueName: '<03|04>', description: 'DATEV chart of accounts of the Mandant: 03 (SKR03) or 04 (SKR04)' },
};

/** `03`, `04`, also written `3`, `SKR03` or `skr 04`. */
export function parseSkr(value: string | undefined): Skr | undefined {
  if (value === undefined) return undefined;
  const match = /^(?:skr\s*)?0?([34])$/i.exec(value.trim());
  if (!match) throw new UsageError(`--skr must be 03 or 04, got "${value}".`);
  return `0${match[1]}` as Skr;
}

/** `--mapping` (or `--out`), else `properties[].mapping` of the property, else `./mapping-<id>.csv`. */
export function mappingPath(loaded: LoadedConfig, propertyId: string | undefined, flag: string | undefined, cwd: string): string {
  if (flag) return resolve(cwd, flag);
  if (!propertyId) {
    throw new UsageError('Name the mapping with --mapping <file> or the property with --property <id>.');
  }
  const configured = loaded.config.properties.find((p) => p.id === propertyId)?.mapping;
  return resolve(cwd, configured ?? `mapping-${propertyId}.csv`);
}

/** `--property`, else the only property in the config, else undefined. */
export function defaultProperty(loaded: LoadedConfig, flag: string | undefined): string | undefined {
  if (flag) return flag;
  const [only, ...others] = loaded.config.properties;
  return only && others.length === 0 ? only.id : undefined;
}
