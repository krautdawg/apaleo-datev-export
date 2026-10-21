import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandContext } from '../cli/context.js';
import { readIfExists } from '../cli/files.js';
import { loadConfig, type LoadedConfig } from '../core/config.js';
import { RecordedApaleoSource } from './source.js';

export { RecordedApaleoSource, type ReadRecorded } from './source.js';

/**
 * `export --demo`: the real pipeline on the bundled data of the fabricated
 * "Hotel Beispiel" in `examples/demo/`, with no config file, no secret and no
 * network. `examples/` sits two levels up from both `src/demo` and `dist/demo`.
 */
export const DEMO_DIR = fileURLToPath(new URL('../../examples/demo/', import.meta.url));
export const DEMO_PROPERTY = 'BSP';
/** The demo clock. The demo data lies in September 2026, so that month is always closed. */
export const DEMO_NOW = '2026-10-05T08:00:00Z';
/** A demo run writes here (relative to the working directory) and nowhere else. */
export const DEMO_OUTPUT_DIR = 'demo-output';

export interface DemoRun {
  loaded: LoadedConfig;
  ctx: CommandContext;
}

/**
 * The demo config (`examples/demo/apaleo-datev.config.yaml`, read without the
 * environment so nothing redirects it), its mapping paths resolved inside the
 * demo folder, output into `./demo-output/`, and a context with the demo clock
 * and the recorded source.
 */
export async function demoRun(ctx: CommandContext): Promise<DemoRun> {
  const loaded = await loadConfig({ path: join(DEMO_DIR, 'apaleo-datev.config.yaml'), env: {}, readFile: ctx.fs.readFile });
  const config = {
    ...loaded.config,
    output: { dir: resolve(ctx.cwd, DEMO_OUTPUT_DIR) },
    properties: loaded.config.properties.map((p) => ({ ...p, mapping: resolve(DEMO_DIR, p.mapping ?? `mapping-${p.id}.csv`) })),
  };
  const source = new RecordedApaleoSource(DEMO_PROPERTY, async (relative) => {
    const bytes = await readIfExists(ctx, join(DEMO_DIR, 'apaleo', relative));
    return bytes && new TextDecoder().decode(bytes);
  });
  return {
    loaded: { path: loaded.path, config, secrets: { apaleoClientSecret: undefined } },
    ctx: { ...ctx, now: () => new Date(DEMO_NOW), sourceFactory: () => source },
  };
}
