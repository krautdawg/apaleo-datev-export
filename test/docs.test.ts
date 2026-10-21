import { describe, expect, it } from 'vitest';
import type { Command } from '../src/cli/command.js';
import { COMMANDS } from '../src/cli/commands/index.js';
import {
  checkCommandLines,
  checkConfigKeys,
  checkFindingCodes,
  checkGerman,
  checkInformalAddress,
  checkLinks,
  configPaths,
  documentationFiles,
  findingCodes,
  functionWords,
  headingSlugs,
  linkTargets,
  readRepoFile,
  shellLines,
  sourceFiles,
  splitLanguageFiles,
} from './helpers/docs.js';

/**
 * Docs never drift from the code (s08 design decision 5): every command line in
 * an sh/bash fence, every backticked config key and every finding code in the
 * documentation must exist in the code. Since s09 (design decision 7) every
 * relative link and anchor must resolve, and the docs are German, with "du".
 */
const FILES = documentationFiles();
const TROUBLESHOOTING = 'docs/troubleshooting.md';
const ENGLISH_README = 'README.en.md';
const DISCLAIMER_TRANSLATION = '## English (non-binding translation)';
/** The German text of a file; `DISCLAIMER.md` carries a non-binding English translation after its German text. */
const germanPart = (file: string) => readRepoFile(file).split(DISCLAIMER_TRANSLATION)[0] ?? '';

describe('README and docs match the code', () => {
  it('covers the READMEs, the community files, the docs folder and the demo README', () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        'README.md',
        ENGLISH_README,
        'docs/setup-apaleo.md',
        'docs/mapping-guide.md',
        'docs/configuration.md',
        TROUBLESHOOTING,
        'CONTRIBUTING.md',
        'SECURITY.md',
        'CODE_OF_CONDUCT.md',
        'DISCLAIMER.md',
        'CHANGELOG.md',
        'docs/examples/README.md',
        'examples/demo/README.md',
      ]),
    );
  });

  it('reads the command lines of the README, also in indented fences of the quick start', () => {
    const lines = shellLines(readRepoFile('README.md')).filter((line) => /^(apaleo-datev|node dist\/cli\/main\.js) /.test(line));
    expect(lines).toEqual(expect.arrayContaining(['apaleo-datev export --month 2026-09 --dry-run', 'node dist/cli/main.js export --month 2026-09 --demo --dry-run']));
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it.each(FILES)('%s: every apaleo-datev command and flag in a shell fence exists', (file) => {
    expect(checkCommandLines(file, readRepoFile(file), COMMANDS)).toEqual([]);
  });

  it.each(FILES)('%s: every backticked config key exists in the schema', (file) => {
    expect(checkConfigKeys(file, readRepoFile(file))).toEqual([]);
  });

  it.each(FILES)('%s: every relative link and anchor resolves', (file) => {
    expect(checkLinks(file, readRepoFile(file))).toEqual([]);
  });

  it.each(FILES.filter((file) => file !== ENGLISH_README))('%s: the prose is German', (file) => {
    expect(checkGerman(file, germanPart(file))).toEqual([]);
  });

  it.each(FILES.filter((file) => file !== 'CODE_OF_CONDUCT.md'))('%s: addresses the reader with "du", never "Sie"', (file) => {
    expect(checkInformalAddress(file, germanPart(file))).toEqual([]);
  });

  it('README.en.md and the translation in DISCLAIMER.md are the only English texts', () => {
    expect(checkGerman(ENGLISH_README, readRepoFile(ENGLISH_README))).toHaveLength(1);
    expect(checkGerman('DISCLAIMER.md', readRepoFile('DISCLAIMER.md').split(DISCLAIMER_TRANSLATION)[1] ?? '')).toHaveLength(1);
  });

  it('has no *.de.md file and no link to one', () => {
    expect(splitLanguageFiles()).toEqual([]);
    for (const file of FILES) expect(linkTargets(readRepoFile(file)).filter((target) => target.includes('.de.md')), file).toEqual([]);
  });

  it('docs/troubleshooting.md documents every finding code in src, and only those', () => {
    const source = new Set(sourceFiles().flatMap((file) => [...findingCodes(readRepoFile(file))]));
    expect(source.size).toBeGreaterThan(40);
    expect(checkFindingCodes(source, findingCodes(readRepoFile(TROUBLESHOOTING)), TROUBLESHOOTING)).toEqual([]);
  });
});

describe('the docs checks', () => {
  const sh = (...lines: string[]) => ['Some text.', '', '```sh', ...lines, '```', ''].join('\n');

  it('names a stale flag, its command and the file', () => {
    const problems = checkCommandLines('docs/datev-import.md', sh('apaleo-datev export --month 2026-10 --email'), COMMANDS);
    expect(problems).toEqual(['docs/datev-import.md: "apaleo-datev export --month 2026-10 --email": --email is not an option of "export"']);
  });

  it('names a renamed command and the file', () => {
    const renamed: Command[] = COMMANDS.map((command) => (command.name === 'export' ? { ...command, name: 'write' } : command));
    const problems = checkCommandLines('README.md', sh('apaleo-datev export --month 2026-10 --dry-run'), renamed);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^README\.md: "apaleo-datev export --month 2026-10 --dry-run": "export" is not a command/);
  });

  it('reads two-word commands, global flags, both program spellings and stops at comments and pipes', () => {
    const text = sh(
      'apaleo-datev mapping check --property BSP --from 2026-09-01 --to 2026-09-30   # --nonsense in a comment',
      'node dist/cli/main.js --help        # or: pnpm link --global',
      'node dist/cli/main.js export --month 2026-09 --demo --dry-run --debug | tee out.txt --x',
      'apaleo-datev live-smoke --property BER [--date 2026-10-18]',
      'APALEO_CLIENT_SECRET=... apaleo-datev export --unknown',
      'docker compose run --rm apaleo-datev export --month 2026-10',
    );
    expect(checkCommandLines('docs/x.md', text, COMMANDS)).toEqual([]);
    expect(checkCommandLines('docs/x.md', sh('apaleo-datev mapping --property BSP'), COMMANDS)).toHaveLength(1);
    expect(checkCommandLines('docs/x.md', sh('apaleo-datev live-smoke [--days 3]'), COMMANDS)).toEqual([
      'docs/x.md: "apaleo-datev live-smoke [--days 3]": --days is not an option of "live-smoke"',
    ]);
  });

  it('ignores command lines outside sh and bash fences', () => {
    const text = ['`apaleo-datev export --email`', '```text', 'apaleo-datev export --email', '```', '```yaml', 'apaleo-datev: --email', '```'].join('\n');
    expect(checkCommandLines('docs/x.md', text, COMMANDS)).toEqual([]);
    expect(checkCommandLines('docs/x.md', ['```bash', 'apaleo-datev export --email', '```'].join('\n'), COMMANDS)).toHaveLength(1);
  });

  it('names a stale config key and the file', () => {
    expect(checkConfigKeys('docs/configuration.md', 'Set `posting.aggregate` to true.')).toEqual([
      'docs/configuration.md: `posting.aggregate` is not a config key',
    ]);
  });

  it('knows nested, defaulted and array keys of the schema', () => {
    const paths = configPaths();
    for (const key of ['apaleo.clientId', 'datev.wjBeginn', 'schedule.monthly.dayOfMonth', 'checks.aggregates', 'properties[].mapping']) {
      expect(paths.has(key), key).toBe(true);
    }
    expect(checkConfigKeys('docs/x.md', '`properties[].mandantennummer` and `properties[].kanzlei`')).toEqual([
      'docs/x.md: `properties[].kanzlei` is not a config key',
    ]);
  });

  it('ignores other backticked text and keys inside code fences', () => {
    const text = [
      'The file name starts with `EXTF_`, cash goes to `1360`, the type is `Revenues`,',
      'the host is `api.apaleo.com`, a value is `checks.aggregates: true`, and `datev` alone is a section.',
      '```yaml',
      '`posting.aggregate`',
      '```',
    ].join('\n');
    expect(checkConfigKeys('docs/x.md', text)).toEqual([]);
  });

  it('reports finding codes missing from the troubleshooting page and codes that no longer exist', () => {
    const problems = checkFindingCodes(new Set(['E-UNMAPPED', 'W-NEW-CODE']), findingCodes('`E-UNMAPPED` and `N-GONE`, E- prefix, E-Mail'), TROUBLESHOOTING);
    expect(problems).toEqual([
      'docs/troubleshooting.md: W-NEW-CODE is used in src but not documented',
      'docs/troubleshooting.md: N-GONE is documented but no longer exists in src',
    ]);
  });
});

describe('the link and anchor check', () => {
  it('names a link to a missing file', () => {
    expect(checkLinks('README.md', 'See [the guide](docs/missing.md).')).toEqual(['README.md: link "docs/missing.md": docs/missing.md does not exist']);
  });

  it('names an anchor that is not a heading of the target, and passes once it is', () => {
    expect(checkLinks('README.md', '[Docker](docs/docker.md#the-demo-in-the-image)')).toEqual([
      'README.md: link "docs/docker.md#the-demo-in-the-image": #the-demo-in-the-image is not a heading of docs/docker.md',
    ]);
    expect(checkLinks('README.md', '[Docker](docs/docker.md#die-demo-im-image)')).toEqual([]);
  });

  it('keeps umlauts in anchors, also percent-encoded', () => {
    expect(checkLinks('docs/x.md', '[FAQ](../README.md#häufige-fragen) and [FAQ](../README.md#h%C3%A4ufige-fragen)')).toEqual([]);
  });

  it('numbers duplicate headings and resolves anchors in the same file', () => {
    const text = ['# Titel', '## Beispiel', '## Beispiel', '', '[zweites](#beispiel-1) und [drittes](#beispiel-2)'].join('\n');
    expect([...headingSlugs(text)]).toEqual(['titel', 'beispiel', 'beispiel-1']);
    expect(checkLinks('docs/x.md', text)).toEqual(['docs/x.md: link "#beispiel-2": #beispiel-2 is not a heading of docs/x.md']);
  });

  it('slugs headings like GitHub: punctuation and backticks dropped, links reduced to their text', () => {
    const text = ['## Festschreibung: 0 oder 1', '### `apaleo`', '## 1. App anlegen', '## Siehe [Leitfaden](x.md)', '```sh', '# kein Heading', '```'].join('\n');
    expect([...headingSlugs(text)]).toEqual(['festschreibung-0-oder-1', 'apaleo', '1-app-anlegen', 'siehe-leitfaden']);
  });

  it('skips external links and links inside code', () => {
    const text = ['[CI](https://github.com/x/y) [Mail](mailto:a@b.de) `[x](nope.md)`', '```md', '[x](nope.md)', '```'].join('\n');
    expect(checkLinks('README.md', text)).toEqual([]);
  });
});

describe('the language checks', () => {
  const german = 'Das Tool liest das Buchungsjournal und schreibt eine Datei für die Kanzlei. Du prüfst die Datei mit der Kanzlei, und sie ist nicht fertig, bis die Kanzlei sie freigibt. Ein Export wird nie zweimal geschrieben, das ist die Regel für jeden Monat auf deinem Rechner.';

  it('accepts German prose and ignores code', () => {
    expect(checkGerman('docs/x.md', `${german}\n\n\`\`\`sh\nthe and with is are for not you your this that\n\`\`\`\n`)).toEqual([]);
  });

  it('names a file whose prose is English', () => {
    const english = 'This is the export. You run it with your config, and the file is written for the Kanzlei. That is not all: the protocol is there too.';
    expect(checkGerman('docs/troubleshooting.md', `${german}\n\n${english}\n${english}\n${english}`)).toEqual([
      expect.stringMatching(/^docs\/troubleshooting\.md: the prose is not German/),
    ]);
    expect(checkGerman('docs/x.md', 'Die Datei.')).toHaveLength(1);
  });

  it('finds an English section that a long German doc would outweigh', () => {
    // The English "Docker Compose" section of the s08 docs/docker.md, appended to the German troubleshooting page.
    const englishSection = readRepoFile('test/fixtures/docs/english-docker-compose.md');
    const markdown = `${readRepoFile(TROUBLESHOOTING)}\n${englishSection}`;
    const { german, english } = functionWords(markdown);
    expect(german).toBeGreaterThanOrEqual(3 * english);
    expect(checkGerman(TROUBLESHOOTING, markdown)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^docs\/troubleshooting\.md: section "Docker Compose \(recommended\)" is not German/)]),
    );
  });

  it('finds an English paragraph inside a German section', () => {
    const english = 'The service runs the export, and the file is written for you. That is not all: this is the protocol for your Kanzlei.';
    const markdown = `## Ablauf\n\n${german}\n\n${german}\n\n${german}\n\n${english}\n`;
    expect(checkGerman('docs/x.md', markdown)).toEqual([expect.stringMatching(/^docs\/x\.md: section "Ablauf" has an English paragraph: "The service runs/)]);
    expect(checkGerman('docs/x.md', `## Ablauf\n\n${german}\n\nDu startest den Container mit \`docker compose up\`, and fertig.\n`)).toEqual([]);
  });

  it('rejects the polite address and accepts "Sie" at the start of a sentence', () => {
    expect(checkInformalAddress('docs/x.md', 'Prüfen Sie die Datei.')).toEqual([
      'docs/x.md: "Prüfen Sie die Datei.": "Sie" is the polite address; write "du"',
    ]);
    expect(checkInformalAddress('docs/x.md', 'Fragen Sie Ihre Kanzlei.')).toHaveLength(2);
    expect(checkInformalAddress('docs/x.md', 'Wenn das passt, senden Sie die Datei.')).toHaveLength(1);
    expect(checkInformalAddress('docs/x.md', 'Danke, Ihr Team')).toHaveLength(1);
    expect(checkInformalAddress('docs/x.md', 'Die Kanzlei bucht. Sie prüft die Datei.\n- Sie bekommt das Protokoll.\n**Sie** entscheidet.')).toEqual([]);
  });
});
