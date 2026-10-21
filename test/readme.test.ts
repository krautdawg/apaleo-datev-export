import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { COMMANDS } from '../src/cli/commands/index.js';
import { ENV_OVERRIDES, SECRET_KEYS } from '../src/core/config.js';
import { APALEO_PERMISSIONS } from '../src/sources/apaleo/index.js';
import { ROOT, commandPhrases, configPaths, readRepoFile } from './helpers/docs.js';

const README = readRepoFile('README.md');
const ENGLISH_README = readRepoFile('README.en.md');
const GERMAN_TAGLINE = 'Kostenloser apaleo DATEV Export: Buchungsstapel (EXTF) für DATEV Rechnungswesen, Open Source';
/** The install block of the German quick start (s09 design decision 3), which CI runs. */
const INSTALL_BLOCK = [
  'git clone https://github.com/krautdawg/apaleo-datev-export.git',
  'cd apaleo-datev-export',
  'corepack enable',
  'pnpm install --frozen-lockfile',
  'pnpm build',
  'node dist/cli/main.js --help        # oder: pnpm link --global, dann apaleo-datev --help',
];

/** The text from the start up to the first `## ` heading. */
const firstScreen = README.slice(0, README.search(/^## /m));
const headings = (text: string, level: string) => [...text.matchAll(new RegExp(`^${level} (.+)$`, 'gm'))].map((m) => m[1] ?? '');
/** The body of the section under a heading, up to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`${heading}\n`);
  if (start < 0) throw new Error(`missing section ${heading}`);
  const level = /^#+/.exec(heading)?.[0] ?? '##';
  const rest = text.slice(start + heading.length + 1);
  const end = rest.search(new RegExp(`^#{1,${level.length}} `, 'm'));
  return end < 0 ? rest : rest.slice(0, end);
}
/** The trimmed, non-empty lines of the first sh block in a text. */
const firstShellBlock = (text: string) =>
  (/```sh\n([\s\S]*?)```/.exec(text)?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
const withoutComment = (line: string) => line.replace(/\s+#.*$/, '');

describe('README first screen', () => {
  it('opens with the H1, the link to the English README, the tagline, badges, the intro and the disclaimer notice before any install detail', () => {
    const [title = '', ...rest] = README.split('\n');
    expect(title).toMatch(/^# /);
    for (const term of ['apaleo DATEV Export', 'kostenlos', 'Open Source']) expect(title).toContain(term);
    expect(rest.find((line) => line.trim() !== '')).toContain('](README.en.md)');
    expect(firstScreen).toContain(GERMAN_TAGLINE);
    for (const badge of ['actions/workflows/ci.yml/badge.svg', 'licence-MIT', 'node.js-24']) expect(firstScreen).toContain(badge);
    expect(firstScreen).toContain('apaleo-datev-export ist');
    expect(firstScreen).toContain('Keine Gewähr, keine Steuerberatung');
    expect(firstScreen).toContain('Lass deine Kontenzuordnung von deiner Steuerberatung prüfen');
    expect(firstScreen).toContain('](DISCLAIMER.md)');
    expect(firstScreen).not.toContain('git clone');
    expect(headings(README, '##')[0]).toBe('Was es macht');
    expect(section(README, '## Was es macht').match(/^- /gm)).toHaveLength(5);
  });

  it('uses the search terms people use in the title, tagline and intro', () => {
    for (const term of ['apaleo', 'DATEV', 'DATEV-Export', 'Buchungsstapel', 'EXTF', 'DATEV-Format', 'SKR03', 'SKR04', 'Steuerberater', 'Hotel', 'Open Source', 'kostenlos']) {
      expect(firstScreen.toLowerCase(), term).toContain(term.toLowerCase());
    }
  });

  it('is German only, with the sections in order', () => {
    expect(headings(README, '##')).toEqual([
      'Was es macht',
      'Für wen',
      'Beispielausgabe ansehen',
      'Ohne apaleo ausprobieren',
      'Schnellstart',
      'Schnellstart mit Docker',
      'Befehle',
      'Konfiguration',
      'Was es nicht macht',
      'Vergleich mit kostenpflichtigen Connectoren',
      'Häufige Fragen',
      'Haftungsausschluss',
      'Mitmachen',
      'Lizenz',
    ]);
    expect(README).not.toMatch(/^#+ (Deutsch|English)$/m);
    expect(README).toMatch(/\bdu\b/);
  });
});

describe('README quick start', () => {
  it('has the five numbered steps in order', () => {
    const quickStart = section(README, '## Schnellstart');
    const numbered = [...quickStart.matchAll(/^(\d)\. \*\*(.+?)\*\*/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(numbered).toEqual(['1 apaleo Custom App anlegen.', '2 Installieren', '3 Kontenzuordnung anlegen', '4 Probelauf', '5 Export']);
    for (const command of ['init-mapping --property', 'export --month 2026-09 --dry-run', 'export --month 2026-09\n']) {
      expect(quickStart).toContain(command);
    }
  });

  it('marks the German install-from-source block for the readme-quickstart CI job', () => {
    expect(firstShellBlock(README.split('<!-- quickstart -->')[1] ?? '')).toEqual(INSTALL_BLOCK);
  });

  it('builds the Docker image locally and shows no dead-end install step', () => {
    expect(section(README, '## Schnellstart mit Docker')).toContain('docker compose -f docker-compose.example.yml build');
    expect(README).toContain('Es gibt noch kein npm-Paket und kein Container-Image zum Herunterladen. Du installierst aus dem Quellcode.');
    for (const text of [README, ENGLISH_README]) {
      expect(text).not.toMatch(/npx\s+apaleo-datev/);
      expect(text).not.toContain('docker pull');
    }
  });

  it('links the example output and the demo', () => {
    expect(section(README, '## Beispielausgabe ansehen')).toContain('](docs/examples/)');
    expect(section(README, '## Ohne apaleo ausprobieren')).toContain('export --month 2026-09 --demo --dry-run');
  });

  it('lists every command in the commands table', () => {
    for (const phrase of commandPhrases(COMMANDS).keys()) {
      expect(section(README, '## Befehle'), phrase).toContain(`| \`${phrase}\` |`);
    }
  });
});

describe('README scope and comparison', () => {
  it('says what the tool does not do', () => {
    const limits = section(README, '## Was es nicht macht');
    for (const phrase of ['Übertragung an DATEV online', 'Debitoren-Stammdaten', 'Gebühren der Zahlungsdienstleister', 'Provisionen der Buchungsportale', 'Weboberfläche', 'gehosteter Dienst']) {
      expect(limits).toContain(phrase);
    }
  });

  it('compares with paid connectors on six points, with dated prices and no vendor name', () => {
    const table = section(README, '## Vergleich mit kostenpflichtigen Connectoren');
    const rows = [...table.matchAll(/^\| ([^|]+?) \|/gm)].map((m) => m[1]?.trim());
    expect(rows).toEqual(expect.arrayContaining(['Preis', 'Betrieb', 'Einrichtung', 'Übertragung an DATEV online', 'Support', 'Vorlagen für die Zuordnung']));
    expect(table).toContain('laut apaleo Store, Oktober 2026');
    expect(table).toContain('Selbst betreiben heißt');
    for (const vendor of ['grman', 'omniboost', 'datev connector']) {
      expect(README.toLowerCase()).not.toContain(vendor);
      expect(ENGLISH_README.toLowerCase()).not.toContain(vendor);
    }
  });

  it('answers the FAQ questions', () => {
    const faq = section(README, '## Häufige Fragen');
    for (const topic of ['Was kostet es', 'Wohin gehen meine Daten', 'DATEV online', 'Festschreibung', 'Mehrere Hotels', 'wechseln', 'Österreich (BMD)']) {
      expect(faq).toContain(topic);
    }
  });
});

describe('README.en.md', () => {
  it('is a short English README that links the German one, the disclaimer and the licence', () => {
    expect(ENGLISH_README.split('\n').length).toBeLessThanOrEqual(80);
    expect(ENGLISH_README.startsWith('# apaleo-datev-export\n')).toBe(true);
    for (const link of ['](README.md)', '](DISCLAIMER.md)', '](LICENSE)']) expect(ENGLISH_README).toContain(link);
    expect(ENGLISH_README).toContain('There is no npm package or container image release yet. You install from source.');
    expect(ENGLISH_README).toMatch(/issues and pull requests in English are welcome/i);
    expect(ENGLISH_README).not.toContain('<!-- quickstart -->');
  });

  it('shows the same install commands as the German quick start, without the shell comments', () => {
    expect(firstShellBlock(ENGLISH_README)).toEqual(INSTALL_BLOCK.map(withoutComment));
    for (const command of ['init-mapping --property BSP --skr 03', 'export --month 2026-09 --dry-run', 'export --month 2026-09\n']) {
      expect(ENGLISH_README).toContain(command);
    }
  });
});

describe('docs folder', () => {
  it('has every guide under one German file name', () => {
    for (const file of [
      'setup-apaleo.md',
      'mapping-guide.md',
      'datev-import.md',
      'configuration.md',
      'docker.md',
      'troubleshooting.md',
      'architecture.md',
      'maintainers.md',
      'datev-format.md',
      'posting-rules.md',
      'export.md',
      'apaleo-source.md',
      'examples/README.md',
    ]) {
      expect(existsSync(join(ROOT, 'docs', file)), file).toBe(true);
    }
    for (const file of ['setup-apaleo.de.md', 'mapping-guide.de.md']) expect(existsSync(join(ROOT, 'docs', file)), file).toBe(false);
  });

  it('docs/setup-apaleo.md lists the exact permissions, the optional one marked optional', () => {
    const text = readRepoFile('docs/setup-apaleo.md');
    for (const permission of [...APALEO_PERMISSIONS.required, ...APALEO_PERMISSIONS.optional]) expect(text).toContain(`\`${permission}\``);
    const [optional] = APALEO_PERMISSIONS.optional;
    expect(text).toMatch(new RegExp(`\`${optional}\`.*\\| optional \\|`));
    expect(text).toContain('Apps > Connected apps');
    expect(text).toContain(APALEO_PERMISSIONS.scopeAlternative);
  });

  it('docs/setup-apaleo.md follows the real apaleo screens in order and recommends "Omit all"', () => {
    const text = readRepoFile('docs/setup-apaleo.md');
    const names = ['Add a new app', 'Add custom app', 'New simple client', 'Secret description', 'Search permission', 'Omit all'];
    const positions = names.map((name) => text.indexOf(`**${name}**`));
    expect(positions.every((position) => position >= 0), names.join(', ')).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const name of ['All properties', 'Only selected properties', 'Retrieve', 'Omit linked']) expect(text).toContain(`**${name}**`);
    expect(text).toContain('Wähle **Omit all**');
  });

  it('describes apaleo as tested live: precise amounts, the first live test and the aggregate rule', () => {
    const source = readRepoFile('docs/apaleo-source.md');
    expect(source).toContain('bis zu acht Nachkommastellen');
    expect(source).toContain('Nur der Bruttobetrag (`grossAmount`) muss ganze Cent sein');
    expect(source).not.toMatch(/ein Betrag, der mehr als 0,0001 von einem ganzen Cent abweicht, stoppt den Export/);
    for (const answer of ['`parentNumber`', '**negativem** Betrag', '`PostPrepaymentVat`', '**Saldo**']) expect(source).toContain(answer);

    const guide = readRepoFile('docs/mapping-guide.md');
    for (const topic of ['/Offset', 'beendet die Suche nicht', '*;AccountsReceivable;;;10000', 'No-Show- und Stornoerlöse', 'Historische Sätze 16 % und 5 %', 'Österreich', 'N-PARENT-ROW-EMPTY', 'N-TEMPLATE-SUGGESTION']) {
      expect(guide.toLowerCase(), topic).toContain(topic.toLowerCase());
    }

    const rules = readRepoFile('docs/posting-rules.md');
    for (const topic of ['**negativem** Betrag', 'Seite **und** Vorzeichen', 'Auflösung Anzahlung 7 %', 'Erlös Logis 7 %', 'performAccountingForOpenInvoiceActions']) {
      expect(rules, topic).toContain(topic);
    }
    expect(readRepoFile('docs/troubleshooting.md')).toContain('performAccountingForOpenInvoiceActions');

    const exportDoc = readRepoFile('docs/export.md');
    expect(exportDoc).toContain('DATEV VAT 37.38, apaleo VAT 37.37, difference 0.01');
    expect(exportDoc).toContain('`sollTotal`, `habenTotal` und `amountTotal` im Manifest sind dieselbe Summe');
  });

  it('documents every config key and every environment variable in docs/configuration.md', () => {
    const text = readRepoFile('docs/configuration.md');
    for (const path of configPaths()) expect(text, path).toContain(`\`${path}\``);
    for (const { variable } of [...ENV_OVERRIDES, ...SECRET_KEYS]) expect(text, variable).toContain(`\`${variable}\``);
    expect(text).toContain('`APALEO_DATEV_CONFIG`');
  });

  it('has the date-dependent rates, every unchecked template row and a sign-off checklist in the mapping guide, and no English summary', () => {
    const guide = readRepoFile('docs/mapping-guide.md');
    expect(guide).not.toContain('English summary');
    expect(guide).toContain('Speisen**: 7 % für Leistungen ab 2026-01-01, 19 % davor');
    expect(guide).toContain('](examples/mapping-BSP.example.csv)');
    const unchecked = ['skr03', 'skr04'].flatMap((skr) =>
      readRepoFile(`templates/${skr}-hotel.rules.csv`)
        .split(/\r?\n/)
        .filter((line) => line.includes('Vorschlag (ungeprüft)')),
    );
    if (unchecked.length === 0) expect(guide).toContain('In Version 2 der Vorlagen ist keine Zeile mit `Vorschlag (ungeprüft)` markiert');
    for (const line of unchecked) expect(guide).toContain(line.split(';').slice(0, 4).join(';'));
    expect(headings(guide, '##').at(-1)).toBe('Checkliste zur Freigabe durch die Kanzlei');
    expect(section(guide, '## Checkliste zur Freigabe durch die Kanzlei').match(/^- \[ \]/gm)?.length).toBeGreaterThanOrEqual(5);
  });

  it('explains the SourceAdapter contract, the canonical ledger line and where tests and fixtures go', () => {
    const architecture = readRepoFile('docs/architecture.md');
    for (const phrase of ['SourceAdapter', 'LedgerLine', 'Smoobu', 'test/fixtures/', 'FakeSource', 'BMD', 'lexoffice']) {
      expect(architecture).toContain(phrase);
    }
  });

  it('has the "Vor der Veröffentlichung" checklist and the later backlog in docs/maintainers.md', () => {
    const maintainers = readRepoFile('docs/maintainers.md');
    expect(maintainers).toContain('**niemand außerhalb kann sie sehen, bis der Maintainer das Repository öffentlich macht**');
    const checklist = section(maintainers, '## Vor der Veröffentlichung');
    for (const step of ['--visibility public', 'Vorschaubild (Social Preview)', 'Discussions', 'v0.1.0']) expect(checklist).toContain(step);
    expect(checklist).not.toContain('## Deutsch');
    const backlog = section(maintainers, '## Später geplant');
    for (const item of ['E-Mail-Versand', 'Verdichtung pro Tag', 'Dauerprozess mit eigenem Zeitplan', 'Überwachung und Alarme', 'Dependabot', 'Veröffentlichung auf npm oder in einer Registry']) {
      expect(backlog).toContain(item);
    }
  });
});

describe('readme-quickstart CI job', () => {
  const workflow = parse(readRepoFile('.github/workflows/ci.yml')) as { jobs: Record<string, { steps: { run?: string }[] }> };
  const runs = workflow.jobs['readme-quickstart']?.steps.map((step) => step.run ?? '') ?? [];

  it('extracts the README block after the quickstart marker, runs it, then the demo dry run', () => {
    expect(runs.join('\n')).toContain('<!-- quickstart -->');
    expect(runs).toContain('bash -euxo pipefail "$RUNNER_TEMP/quickstart.sh"');
    expect(runs.at(-1)).toBe('node dist/cli/main.js export --month 2026-09 --demo --dry-run');
  });
});
