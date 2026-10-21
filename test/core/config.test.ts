import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigNotFoundError,
  ENV_OVERRIDES,
  loadConfig,
  resolveConfigPath,
  type Env,
} from '../../src/core/config.js';
import { UserError } from '../../src/core/errors.js';
import { runCli } from '../../src/cli/run.js';
import { EXIT_OK, type Command } from '../../src/cli/command.js';
import { createTestContext } from '../helpers/context.js';

const VALID = 'datev:\n  beraternummer: 1234567\n  mandantennummer: 42\n';
const APALEO_DEFAULTS = { baseUrl: 'https://api.apaleo.com', identityUrl: 'https://identity.apaleo.com' };

async function load(content: string, env: Env = {}, fileName = 'apaleo-datev.config.yaml') {
  const ctx = createTestContext({ files: { [fileName]: content }, env });
  return loadConfig({ path: join(ctx.cwd, fileName), env: ctx.env, readFile: ctx.fs.readFile });
}

async function loadError(content: string, env: Env = {}, fileName?: string): Promise<UserError> {
  const error = await load(content, env, fileName).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UserError);
  return error as UserError;
}

describe('config path resolution', () => {
  it('prefers --config, then APALEO_DATEV_CONFIG, then the default file', () => {
    const env = { APALEO_DATEV_CONFIG: 'from-env.yaml' };
    expect(resolveConfigPath('flag.yaml', env, '/work')).toBe(resolve('/work/flag.yaml'));
    expect(resolveConfigPath(undefined, env, '/work')).toBe(resolve('/work/from-env.yaml'));
    expect(resolveConfigPath(undefined, {}, '/work')).toBe(resolve('/work/apaleo-datev.config.yaml'));
    expect(resolveConfigPath('/abs/c.json', env, '/work')).toBe('/abs/c.json');
  });
});

describe('loading', () => {
  it('loads YAML and fills defaults', async () => {
    const { config, secrets } = await load(VALID);
    expect(config).toEqual({
      apaleo: APALEO_DEFAULTS,
      output: { dir: './exports' },
      datev: { beraternummer: 1234567, mandantennummer: 42, sachkontenlaenge: 4, wjBeginn: '01-01', festschreibung: 0 },
      posting: { belegfeld1: 'receipt' },
      properties: [],
      checks: { aggregates: false },
      schedule: { timezone: 'Europe/Berlin', cadence: 'monthly', daily: { offsetDays: 2 }, monthly: { dayOfMonth: 3 }, finalAfter: '06:00', catchUpDays: 40 },
    });
    expect(secrets.apaleoClientSecret).toBeUndefined();
  });

  it('reads the export settings of the datev section', async () => {
    const { config } = await load(`datev:\n  beraternummer: 1234567\n  mandantennummer: 42\n  wjBeginn: "07-01"\n  skr: 03\n  festschreibung: 1\n`);
    expect(config.datev).toMatchObject({ wjBeginn: '07-01', skr: '03', festschreibung: 1 });
    for (const written of ['"04"', 'SKR04', '4']) {
      expect((await load(`${VALID}  skr: ${written}\n`)).config.datev.skr).toBe('04');
    }
  });

  it('rejects an invalid fiscal-year start, SKR or Festschreibung', async () => {
    const error = await loadError(`${VALID}  wjBeginn: "02-29"\n  skr: "05"\n  festschreibung: 2\n`);
    expect(error.message).toContain('datev.wjBeginn: must be a month and day written MM-DD');
    expect(error.message).toContain('datev.skr: must be "03" (SKR03) or "04" (SKR04) (got "05")');
    expect(error.message).toContain('datev.festschreibung: must be 0 or 1 (got 2)');
    expect((await loadError(`${VALID}  wjBeginn: "13-01"\n`)).message).toContain('datev.wjBeginn');
  });

  it('reads a Mandantennummer per property and checks.aggregates', async () => {
    const { config } = await load(`${VALID}properties:\n  - id: BSP\n    mandantennummer: 43\nchecks:\n  aggregates: true\n`);
    expect(config.properties).toEqual([{ id: 'BSP', mandantennummer: 43 }]);
    expect(config.checks).toEqual({ aggregates: true });
    const error = await loadError(`${VALID}properties:\n  - id: BSP\n    mandantennummer: 0\nchecks:\n  aggregates: yes please\n`);
    expect(error.message).toContain('properties.0.mandantennummer: must be a whole number between 1 and 99999');
    expect(error.message).toContain('checks.aggregates: must be true or false');
  });

  it('reads posting.belegfeld1 and rejects other values', async () => {
    const { config } = await load(`${VALID}posting:\n  belegfeld1: reference\n`);
    expect(config.posting).toEqual({ belegfeld1: 'reference' });
    await expect(load(`${VALID}posting:\n  belegfeld1: invoice\n`)).rejects.toThrow(
      'posting.belegfeld1: must be "receipt" or "reference" (got "invoice")',
    );
  });

  it('loads JSON by extension', async () => {
    const json = JSON.stringify({ datev: { beraternummer: 1001, mandantennummer: 1, sachkontenlaenge: 6 } });
    const { config } = await load(json, {}, 'config.json');
    expect(config.datev.sachkontenlaenge).toBe(6);
  });

  it('reads the client secret from the environment only', async () => {
    const { secrets } = await load(VALID, { APALEO_CLIENT_SECRET: 'abc' });
    expect(secrets.apaleoClientSecret).toBe('abc');
  });

  const example = readFileSync(new URL('../../apaleo-datev.config.example.yaml', import.meta.url), 'utf8');

  it('rejects the unedited example config until the Kanzlei numbers are filled in', async () => {
    const error = await loadError(example);
    expect(error.message).toContain('datev.beraternummer: is required');
    expect(error.message).toContain('datev.mandantennummer: is required');
  });

  it('accepts the example config once the Kanzlei numbers are filled in', async () => {
    const filled = example
      .replace(/beraternummer:\s*$/m, 'beraternummer: 1234567')
      .replace(/mandantennummer:\s*$/m, 'mandantennummer: 42');
    const { config } = await load(filled, { APALEO_CLIENT_ID: 'client-1' });
    expect(config.output.dir).toBe('./exports');
    expect(config.apaleo.clientId).toBe('client-1');
    expect(config.datev).toEqual({ beraternummer: 1234567, mandantennummer: 42, sachkontenlaenge: 4, wjBeginn: '01-01', festschreibung: 0 });
    expect(config.checks).toEqual({ aggregates: false });
    expect(config.schedule).toEqual({ timezone: 'Europe/Berlin', cadence: 'monthly', daily: { offsetDays: 2 }, monthly: { dayOfMonth: 3 }, finalAfter: '06:00', catchUpDays: 40 });
  });

  it('treats a section whose keys are all commented out as missing, with or without env overrides', async () => {
    const file = `apaleo:\n  # clientId: abc\noutput:\n  # dir: ./x\n${VALID}`;
    const { config } = await load(file);
    expect(config.apaleo).toEqual(APALEO_DEFAULTS);
    expect(config.output.dir).toBe('./exports');
    const withEnv = await load(file, { APALEO_CLIENT_ID: 'client-1' });
    expect(withEnv.config.apaleo.clientId).toBe('client-1');
  });

  it('reports an empty required value as required', async () => {
    const error = await loadError('datev:\n  beraternummer:\n  mandantennummer: 42\n');
    expect(error.message).toContain('datev.beraternummer: is required');
    expect(await loadError('datev:\n').then((e) => e.message)).toContain('datev: is required');
  });
});

describe('apaleo section', () => {
  it('accepts scopes and other API hosts, without a trailing slash', async () => {
    const file = `apaleo:\n  clientId: abc\n  scopes: "accounting.read"\n  baseUrl: https://api.example.test/\n  identityUrl: http://localhost:8080\n${VALID}`;
    const { config } = await load(file);
    expect(config.apaleo).toEqual({
      clientId: 'abc',
      scopes: 'accounting.read',
      baseUrl: 'https://api.example.test',
      identityUrl: 'http://localhost:8080',
    });
  });

  it('rejects a base URL that is not https', async () => {
    const error = await loadError(`apaleo:\n  baseUrl: ftp://api.apaleo.com\n${VALID}`);
    expect(error.message).toContain(
      'apaleo.baseUrl: must be an https URL (plain http only for localhost, 127.0.0.1 or [::1]) (got "ftp://api.apaleo.com")',
    );
  });

  it.each(['baseUrl: http://api.apaleo.com', 'identityUrl: http://identity.apaleo.com', 'baseUrl: http://localhost.evil.test'])(
    'rejects plain http for a host that is not this machine (%s)',
    async (line) => {
      const error = await loadError(`apaleo:\n  ${line}\n${VALID}`);
      expect(error.message).toMatch(/apaleo\.(baseUrl|identityUrl): must be an https URL/);
    },
  );

  it('accepts plain http for 127.0.0.1 and [::1]', async () => {
    const { config } = await load(`apaleo:\n  baseUrl: http://127.0.0.1:4010\n  identityUrl: "http://[::1]:4011/"\n${VALID}`);
    expect(config.apaleo.baseUrl).toBe('http://127.0.0.1:4010');
    expect(config.apaleo.identityUrl).toBe('http://[::1]:4011');
  });
});

describe('validation errors name the key path', () => {
  it('rejects datev.beraternummer: 12 with the allowed range', async () => {
    const error = await loadError('datev:\n  beraternummer: 12\n  mandantennummer: 42\n');
    expect(error.message).toContain('datev.beraternummer: must be a whole number between 1001 and 9999999 (got 12)');
  });

  it.each([
    ['mandantennummer: 0', 'datev.mandantennummer'],
    ['mandantennummer: 1.5', 'datev.mandantennummer'],
    ['mandantennummer: "42"', 'datev.mandantennummer'],
  ])('rejects %s', async (line, key) => {
    const error = await loadError(`datev:\n  beraternummer: 1001\n  ${line}\n`);
    expect(error.message).toContain(`${key}: must be a whole number between 1 and 99999`);
  });

  it('rejects sachkontenlaenge outside 4-8', async () => {
    const error = await loadError(`${VALID}  sachkontenlaenge: 9\n`);
    expect(error.message).toContain('datev.sachkontenlaenge: must be a whole number between 4 and 8');
  });

  it('reports missing required keys', async () => {
    const error = await loadError('output:\n  dir: ./x\n');
    expect(error.message).toContain('datev: is required');
  });

  it('reports unknown keys with their path', async () => {
    const error = await loadError(`${VALID}  beratrnummer: 1\nfoo: 1\n`);
    expect(error.message).toContain('datev.beratrnummer: unknown key');
    expect(error.message).toContain('foo: unknown key');
  });

  it('reports YAML syntax errors with the file path', async () => {
    const error = await loadError('datev: [unclosed\n');
    expect(error.message).toMatch(/Cannot parse config file .*apaleo-datev\.config\.yaml: line \d+, column \d+: /);
  });

  it('does not quote neighbouring lines, such as a secret, in a YAML syntax error', async () => {
    const error = await loadError(`${VALID}apaleo:\n  clientId: "unclosed\nclientSecret: SUPERSECRET\n`);
    expect(error.message).toMatch(/line \d+, column \d+: missing closing quote or bracket\.$/);
    expect(error.message).not.toContain('SUPERSECRET');
    expect(error.message).not.toContain('unclosed');
    expect(error.message).not.toContain('^');
  });

  it.each([
    ['{"apaleo": {"clientId": "a", "clientSecret": SUPERSECRET}}', /: invalid JSON\.$/],
    ['{"apaleo": {"clientSecret": "SUPERSECRET"', /line 1, column \d+: invalid JSON\.$/],
  ])('does not quote the source in a JSON syntax error: %s', async (json, pattern) => {
    const error = await loadError(json, {}, 'config.json');
    expect(error.message).toMatch(pattern);
    expect(error.message).not.toContain('SUPERSECRET');
  });

  it('rejects a top level that is not key/value settings', async () => {
    const error = await loadError('- a\n- b\n');
    expect(error.message).toContain('must contain key/value settings');
  });
});

describe('properties section', () => {
  it('reads properties with an optional mapping path', async () => {
    const { config } = await load(`${VALID}properties:\n  - id: BSP\n    mapping: ./maps/bsp.csv\n  - id: HBW\n`);
    expect(config.properties).toEqual([{ id: 'BSP', mapping: './maps/bsp.csv' }, { id: 'HBW' }]);
  });

  it('names the key path of an invalid entry', async () => {
    const error = await loadError(`${VALID}properties:\n  - id: BSP\n    mapping: ""\n  - mappin: x\n`);
    expect(error.message).toContain('properties.0.mapping: must not be empty');
    expect(error.message).toContain('properties.1.id: is required');
    expect(error.message).toContain('properties.1.mappin: unknown key');
  });

  it('rejects a property id listed twice', async () => {
    const error = await loadError(`${VALID}properties:\n  - id: BSP\n  - id: BSP\n`);
    expect(error.message).toContain('properties: must not list a property id twice');
  });
});

describe('schedule section', () => {
  it('reads a daily schedule', async () => {
    const { config } = await load(`${VALID}schedule:\n  timezone: Europe/Zurich\n  cadence: daily\n  daily:\n    offsetDays: 3\n  catchUpDays: 10\n`);
    expect(config.schedule).toEqual({ timezone: 'Europe/Zurich', cadence: 'daily', daily: { offsetDays: 3 }, monthly: { dayOfMonth: 3 }, finalAfter: '06:00', catchUpDays: 10 });
  });

  it('names schedule.daily.offsetDays and the range 1 to 3 for offsetDays 0', async () => {
    const error = await loadError(`${VALID}schedule:\n  cadence: daily\n  daily:\n    offsetDays: 0\n`);
    expect(error.message).toContain('schedule.daily.offsetDays: must be a whole number between 1 and 3 (got 0)');
  });

  it('limits monthly.dayOfMonth to 1 to 5', async () => {
    const error = await loadError(`${VALID}schedule:\n  monthly:\n    dayOfMonth: 6\n`);
    expect(error.message).toContain('schedule.monthly.dayOfMonth: must be a whole number between 1 and 5 (got 6)');
  });

  it('accepts exactly one cadence, monthly or daily', async () => {
    for (const cadence of ['weekly', '[daily, monthly]']) {
      const error = await loadError(`${VALID}schedule:\n  cadence: ${cadence}\n`);
      expect(error.message).toContain('schedule.cadence: must be "monthly" or "daily"');
    }
  });

  it('refuses a fixed UTC offset or an unknown zone as schedule.timezone', async () => {
    for (const zone of ['"+01:00"', 'Berlin', 'CEST+1']) {
      const error = await loadError(`${VALID}schedule:\n  timezone: ${zone}\n`);
      expect(error.message).toContain('schedule.timezone: must be an IANA time zone name');
    }
  });

  it('refuses a daily catch-up window under 5 days, so a day held back as not yet final is still exported later', async () => {
    for (const offsetDays of [1, 2, 3]) {
      const error = await loadError(`${VALID}schedule:\n  cadence: daily\n  daily:\n    offsetDays: ${offsetDays}\n  catchUpDays: 4\n`);
      expect(error.message).toContain('schedule.catchUpDays: must be at least 5 with cadence daily');
    }
    const { config } = await load(`${VALID}schedule:\n  cadence: daily\n  daily:\n    offsetDays: 1\n  catchUpDays: 5\n`);
    expect(config.schedule.catchUpDays).toBe(5);
  });

  it('refuses a monthly catch-up window under 3 days', async () => {
    const error = await loadError(`${VALID}schedule:\n  catchUpDays: 2\n`);
    expect(error.message).toContain('schedule.catchUpDays: must be at least 3 with cadence monthly');
    const { config } = await load(`${VALID}schedule:\n  catchUpDays: 3\n`);
    expect(config.schedule.catchUpDays).toBe(3);
  });

  it('reads schedule.finalAfter as a quoted local time up to 12:00 and refuses anything else', async () => {
    const { config } = await load(`${VALID}schedule:\n  finalAfter: "04:30"\n`);
    expect(config.schedule.finalAfter).toBe('04:30');
    for (const value of ['"13:00"', '"6:00"', '"24:00"', '6', 'morning']) {
      const error = await loadError(`${VALID}schedule:\n  finalAfter: ${value}\n`);
      expect(error.message).toContain('schedule.finalAfter: must be a local time "HH:MM" between "00:00" and "12:00"');
    }
  });

  it('rejects unknown schedule keys', async () => {
    const error = await loadError(`${VALID}schedule:\n  weekly: {}\n`);
    expect(error.message).toContain('schedule.weekly: unknown key');
  });
});

describe('secrets', () => {
  it('rejects apaleo.clientSecret in the file and points to APALEO_CLIENT_SECRET', async () => {
    const error = await loadError(`apaleo:\n  clientId: abc\n  clientSecret: oops\n${VALID}`);
    expect(error.message).toContain('apaleo.clientSecret must not be stored in the config file');
    expect(error.message).toContain('set APALEO_CLIENT_SECRET in the environment');
    expect(error.message).not.toContain('oops');
  });
});

describe('environment overrides', () => {
  it('APALEO_DATEV_OUTPUT_DIR wins over output.dir in the file', async () => {
    const { config } = await load(`${VALID}output:\n  dir: ./out\n`, { APALEO_DATEV_OUTPUT_DIR: '/data/out' });
    expect(config.output.dir).toBe('/data/out');
  });

  it('applies every allow-listed scalar override', async () => {
    const { config } = await load(VALID, {
      APALEO_CLIENT_ID: 'client-1',
      APALEO_DATEV_BERATERNUMMER: '7654321',
      APALEO_DATEV_MANDANTENNUMMER: '99',
    });
    expect(config.apaleo.clientId).toBe('client-1');
    expect(config.datev.beraternummer).toBe(7654321);
    expect(config.datev.mandantennummer).toBe(99);
  });

  it('APALEO_DATEV_TIMEZONE sets schedule.timezone and is validated like the file value', async () => {
    const { config } = await load(VALID, { APALEO_DATEV_TIMEZONE: 'Europe/Vienna' });
    expect(config.schedule.timezone).toBe('Europe/Vienna');
    const error = await loadError(VALID, { APALEO_DATEV_TIMEZONE: 'Mars/Olympus' });
    expect(error.message).toContain('schedule.timezone: must be an IANA time zone name');
    expect(error.message).toContain('from APALEO_DATEV_TIMEZONE');
  });

  it('ignores empty override values', async () => {
    const { config } = await load(VALID, { APALEO_DATEV_OUTPUT_DIR: '' });
    expect(config.output.dir).toBe('./exports');
  });

  it('names the variable when an override value is invalid', async () => {
    const notNumber = await loadError(VALID, { APALEO_DATEV_BERATERNUMMER: 'abc' });
    expect(notNumber.message).toContain('APALEO_DATEV_BERATERNUMMER must be a whole number');
    const outOfRange = await loadError(VALID, { APALEO_DATEV_BERATERNUMMER: '12' });
    expect(outOfRange.message).toContain('datev.beraternummer');
    expect(outOfRange.message).toContain('from APALEO_DATEV_BERATERNUMMER');
  });

  it('rejects an unknown APALEO_DATEV_* variable and names it', async () => {
    const error = await loadError(VALID, { APALEO_DATEV_OUTPUTDIR: '/x' });
    expect(error.message).toContain('APALEO_DATEV_OUTPUTDIR: unknown variable');
    expect(error.message).toContain('APALEO_DATEV_OUTPUT_DIR');
  });

  it('rejects an array key set from the environment', async () => {
    const error = await loadError(VALID, { APALEO_DATEV_PROPERTIES: 'BER,MUC' });
    expect(error.message).toContain('APALEO_DATEV_PROPERTIES');
    expect(error.message).toContain('"properties" is an array and can only be set in the config file');
  });

  it('ignores unrelated environment variables', async () => {
    await expect(load(VALID, { PATH: '/usr/bin', APALEO_OTHER: 'x' })).resolves.toBeDefined();
  });

  it('only allow-lists scalar keys', () => {
    expect(ENV_OVERRIDES.map((o) => o.variable)).toEqual([
      'APALEO_DATEV_OUTPUT_DIR',
      'APALEO_CLIENT_ID',
      'APALEO_DATEV_BERATERNUMMER',
      'APALEO_DATEV_MANDANTENNUMMER',
      'APALEO_DATEV_TIMEZONE',
    ]);
  });
});

describe('missing config file', () => {
  it('throws ConfigNotFoundError with the path and how to create the file', async () => {
    const ctx = createTestContext();
    const path = join(ctx.cwd, 'apaleo-datev.config.yaml');
    const error = await loadConfig({ path, env: {}, readFile: ctx.fs.readFile }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigNotFoundError);
    expect((error as Error).message).toContain(path);
    expect((error as Error).message).toContain('apaleo-datev.config.example.yaml');
  });

  it('makes a command that needs config exit 1 with the path it looked for', async () => {
    const needsConfig: Command = {
      name: 'needs-config',
      summary: 'Loads the config',
      usage: '',
      options: {},
      async run(_args, ctx) {
        const path = resolveConfigPath(undefined, ctx.env, ctx.cwd);
        await loadConfig({ path, env: ctx.env, readFile: ctx.fs.readFile });
        return EXIT_OK;
      },
    };
    const ctx = createTestContext();
    expect(await runCli(['needs-config'], ctx, [needsConfig])).toBe(1);
    expect(ctx.err()).toContain(`No config file found at ${join(ctx.cwd, 'apaleo-datev.config.yaml')}`);
    expect(ctx.err()).toContain('--config <path>');
    expect(ctx.err()).not.toMatch(/\n\s+at /);
  });
});
