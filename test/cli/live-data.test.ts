import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import { FIXTURE_FILES, createApaleoContext, fixturePath } from '../helpers/apaleo.js';

/**
 * The CLI on the recorded apaleo sandbox responses (`test/fixtures/apaleo/live/`)
 * through the fake apaleo API: what v0.1.0 could not read at all.
 */

/** After the recorded days, so both are closed. */
const AFTER_THE_DAY = new Date('2026-10-25T08:00:00Z');
const LIVE_MAPPING = readFileSync(fixturePath('live/BER/mapping-BER.live.csv'), 'utf8');

function liveContext(extraConfig = '', files: Record<string, string> = {}) {
  const config = `${FIXTURE_FILES['apaleo-datev.config.yaml']}  skr: '03'\nproperties:\n  - id: BER\n  - id: VIE\n${extraConfig}`;
  return createApaleoContext({ live: true }, { files: { 'apaleo-datev.config.yaml': config, 'mapping-BER.csv': LIVE_MAPPING, ...files }, now: AFTER_THE_DAY });
}

describe('mapping check on the recorded BER day', () => {
  it('passes with the committed live SKR03 mapping', async () => {
    const ctx = liveContext();
    expect(await runCli(['mapping', 'check', '--property', 'BER', '--from', '2026-10-21', '--to', '2026-10-21'], ctx)).toBe(0);
    expect(ctx.out()).not.toMatch(/sub-cent|not a whole number of cents/);
    expect(ctx.out()).toContain('Result: mapping OK.');
  });
});
