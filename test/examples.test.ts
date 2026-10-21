import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run.js';
import { BSP } from './helpers/apaleo.js';
import { exportSetup } from './helpers/export.js';
import { describeDifference } from './helpers/golden.js';

/**
 * `docs/examples/` shows a Kanzlei the output before any setup, and
 * `examples/demo/` feeds `export --demo`. Both are copies of the golden file
 * and the Hotel Beispiel fixtures, and must stay identical to them. After an
 * intended change to the protocol, run `UPDATE_GOLDEN=1 pnpm test`.
 */
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string) => readFileSync(root(path));
const FILE = 'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.csv';
const PROTOCOL = 'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.protokoll.txt';

function filesIn(dir: string): string[] {
  return readdirSync(root(dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root(dir), join(entry.parentPath, entry.name)))
    .sort();
}

describe('docs/examples', () => {
  it('holds the current golden EXTF file byte for byte', () => {
    const difference = describeDifference(read(`test/golden/export/${FILE}`), read(`docs/examples/${FILE}`));
    expect(difference, `docs/examples/${FILE} differs from the golden file:\n${difference}`).toBeUndefined();
  });

  it('holds the protocol the export writes beside that file', async () => {
    const setup = exportSetup();
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(0);
    const protocol = readFileSync(join(setup.ctx.cwd, 'exports', BSP, '2026-09', PROTOCOL));
    if (UPDATE) writeFileSync(root(`docs/examples/${PROTOCOL}`), protocol);
    expect(read(`docs/examples/${PROTOCOL}`).toString('utf8')).toBe(protocol.toString('utf8'));
  });

  it('holds the mapping that produced the file, with the city-tax decision commented', () => {
    const mapping = read('docs/examples/mapping-BSP.example.csv');
    expect(mapping.equals(read('test/fixtures/mapping/skr03-beispiel.csv'))).toBe(true);
    expect(mapping.toString('utf8')).toMatch(/^3501;CityTaxes;.*;1590;.*Kurtaxe, Gast schuldet/m);
  });
});

describe('examples/demo', () => {
  it('holds exact copies of the Hotel Beispiel apaleo fixtures', () => {
    const recorded = filesIn('examples/demo/apaleo');
    expect(recorded).toEqual(filesIn('test/fixtures/apaleo').filter((file) => file.endsWith('.json') && !file.includes('swagger')));
    for (const file of recorded) {
      expect(read(`examples/demo/apaleo/${file}`).equals(read(`test/fixtures/apaleo/${file}`)), file).toBe(true);
    }
  });

  it('uses the example mapping', () => {
    expect(read('examples/demo/mapping-BSP.csv').equals(read('docs/examples/mapping-BSP.example.csv'))).toBe(true);
  });
});
