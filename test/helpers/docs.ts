import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { COMMON_OPTIONS, type Command } from '../../src/cli/command.js';
import { configSchema } from '../../src/core/config.js';

/**
 * The docs consistency rules (s08 design decision 5, extended in s09 design
 * decision 7). Each check takes the
 * text of one Markdown file and returns one problem per stale mention, naming
 * the file, so a failing test says exactly what to fix.
 */

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The root-level Markdown files the docs checks cover (s09 design decision 7). */
const ROOT_DOCS = ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'DISCLAIMER.md', 'CHANGELOG.md'];

/** The checked documentation: root files, every Markdown file under `docs/`, and the demo README, relative to the repository root. */
export function documentationFiles(): string[] {
  const docs = readdirSync(join(ROOT, 'docs'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
  return [...ROOT_DOCS, ...docs.sort(), 'examples/demo/README.md'];
}

export function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** `src/**\/*.ts`, relative to the repository root. */
export function sourceFiles(): string[] {
  return readdirSync(join(ROOT, 'src'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)))
    .sort();
}

// --- Commands --------------------------------------------------------------

const PROGRAMS = ['apaleo-datev ', 'node dist/cli/main.js '];
/** Flags the CLI accepts before or instead of a command, and on every command. */
const TOP_LEVEL_FLAGS = new Set(['help', 'version']);
const GLOBAL_FLAGS = new Set(Object.keys(COMMON_OPTIONS));

/** Lines inside ```sh and ```bash fences. */
export function shellLines(markdown: string): string[] {
  const lines: string[] = [];
  let inShell = false;
  let inFence = false;
  for (const line of markdown.split('\n')) {
    const fence = /^\s*```\s*([A-Za-z]*)/.exec(line);
    if (fence) {
      inShell = !inFence && (fence[1] === 'sh' || fence[1] === 'bash');
      inFence = !inFence;
      continue;
    }
    if (inShell) lines.push(line.trim());
  }
  return lines;
}

/**
 * The words a doc may use to name each command: its name, or for a command
 * whose usage starts with a fixed positional word (`mapping check`), both words.
 */
export function commandPhrases(commands: readonly Command[]): Map<string, Command> {
  const phrases = new Map<string, Command>();
  for (const command of commands) {
    const subcommand = command.allowPositionals ? /^([a-z][a-z-]*)\b/.exec(command.usage)?.[1] : undefined;
    phrases.set(subcommand ? `${command.name} ${subcommand}` : command.name, command);
  }
  return phrases;
}

/** Problems with the `apaleo-datev` command lines in the shell fences of one file. */
export function checkCommandLines(file: string, markdown: string, commands: readonly Command[]): string[] {
  const phrases = commandPhrases(commands);
  const problems: string[] = [];
  for (const raw of shellLines(markdown)) {
    const program = PROGRAMS.find((p) => raw.startsWith(p));
    if (!program) continue;
    // A shell comment, pipe, redirection or second command ends the apaleo-datev part.
    const line = raw.slice(program.length).split(/\s(?:#|&&|\|\||\||>>?|;)/)[0]?.trim() ?? '';
    const words = line.split(/\s+/).filter(Boolean);
    const flags = [...line.matchAll(/(?:^|[\s[])--([A-Za-z][\w-]*)/g)].map((m) => m[1] ?? '');
    if (words[0] === undefined || words[0].startsWith('-')) {
      for (const flag of flags.filter((f) => !TOP_LEVEL_FLAGS.has(f))) {
        problems.push(`${file}: "${raw}": --${flag} is not an option of ${program.trim()} without a command`);
      }
      continue;
    }
    const phrase = [`${words[0]} ${words[1] ?? ''}`, words[0]].find((p) => phrases.has(p));
    const command = phrase === undefined ? undefined : phrases.get(phrase);
    if (!command) {
      problems.push(`${file}: "${raw}": "${words[0]}" is not a command (commands: ${[...phrases.keys()].join(', ')})`);
      continue;
    }
    for (const flag of flags) {
      if (!(flag in command.options) && !GLOBAL_FLAGS.has(flag)) {
        problems.push(`${file}: "${raw}": --${flag} is not an option of "${phrase}"`);
      }
    }
  }
  return problems;
}

// --- Config keys -------------------------------------------------------------

/**
 * A backticked config key. The design's pattern plus an optional `[]` after the
 * section, so `properties[].mapping` is checked too and not silently ignored.
 */
export const CONFIG_KEY = /^(apaleo|datev|output|posting|properties|schedule|checks)(\[\])?(\.[A-Za-z[\]]+)+$/;

interface SchemaDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  in?: z.ZodType;
}

const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: SchemaDef } })._zod.def;

/** Every key path of the config schema, arrays written as `properties[].mapping`. */
export function configPaths(schema: z.ZodType = configSchema): Set<string> {
  const paths = new Set<string>();
  const visit = (node: z.ZodType, path: string) => {
    const def = defOf(node);
    if (def.innerType) return visit(def.innerType, path);
    if (def.type === 'pipe' && def.in) return visit(def.in, path);
    if (path && !path.endsWith('[]')) paths.add(path);
    if (def.type === 'array' && def.element) return visit(def.element, `${path}[]`);
    if (def.type === 'object' && def.shape) {
      for (const [key, child] of Object.entries(def.shape)) visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(schema, '');
  return paths;
}

/** Text inside single backticks, outside code fences. */
export function backtickedTokens(markdown: string): string[] {
  const prose = markdown.replace(/^\s*```[\s\S]*?^\s*```/gm, '');
  return [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
}

/** Problems with the backticked config keys of one file. */
export function checkConfigKeys(file: string, markdown: string, paths: ReadonlySet<string> = configPaths()): string[] {
  return backtickedTokens(markdown)
    .filter((token) => CONFIG_KEY.test(token) && !paths.has(token))
    .map((token) => `${file}: \`${token}\` is not a config key`);
}

// --- Finding codes -----------------------------------------------------------

export const FINDING_CODE = /\b[EWN]-[A-Z][A-Z-]+\b/g;

export function findingCodes(text: string): Set<string> {
  return new Set(text.match(FINDING_CODE) ?? []);
}

/** Codes used in the source but missing from the troubleshooting page, and documented codes the source no longer has. */
export function checkFindingCodes(source: ReadonlySet<string>, documented: ReadonlySet<string>, file: string): string[] {
  return [
    ...[...source].filter((code) => !documented.has(code)).map((code) => `${file}: ${code} is used in src but not documented`),
    ...[...documented].filter((code) => !source.has(code)).map((code) => `${file}: ${code} is documented but no longer exists in src`),
  ];
}

// --- Links and anchors -------------------------------------------------------

/** The text with code fences removed, so `#` shell comments are not headings and code is not prose. */
export function withoutFences(markdown: string): string {
  return markdown.replace(/^\s*```[\s\S]*?^\s*```[^\n]*$/gm, '');
}

/** GitHub's heading anchors: lower case, only letters (umlauts and ß kept), digits, `_`, spaces and hyphens, spaces to hyphens, `-1`, `-2` for duplicates. */
export function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const match of withoutFences(markdown).matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const text = (match[1] ?? '').replace(/\]\([^)]*\)/g, ']');
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_ -]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

/** Relative link targets (`](path#anchor)`) outside code fences and inline code. */
export function linkTargets(markdown: string): string[] {
  const prose = withoutFences(markdown).replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)]
    .map((m) => m[1] ?? '')
    .filter((target) => !/^(https?:|mailto:)/i.test(target));
}

/** Problems with the relative links of one file: a missing target, or an anchor that is not a heading of its target. */
export function checkLinks(file: string, markdown: string, root: string = ROOT): string[] {
  const problems: string[] = [];
  for (const target of linkTargets(markdown)) {
    const [rawPath = '', rawAnchor] = target.split('#', 2);
    const path = decodeURIComponent(rawPath);
    const resolved = path === '' ? join(root, file) : join(root, dirname(file), path);
    if (path !== '' && !existsSync(resolved)) {
      problems.push(`${file}: link "${target}": ${relative(root, resolved)} does not exist`);
      continue;
    }
    if (rawAnchor === undefined) continue;
    const anchor = decodeURIComponent(rawAnchor).toLowerCase();
    const text = path === '' ? markdown : statSync(resolved).isFile() ? readFileSync(resolved, 'utf8') : '';
    if (!headingSlugs(text).has(anchor)) {
      problems.push(`${file}: link "${target}": #${anchor} is not a heading of ${relative(root, resolved)}`);
    }
  }
  return problems;
}

/** `*.de.md` files outside `node_modules/`, `dist/`, `.git/` and `openspec/`: German is the only language, so there are no split files. */
export function splitLanguageFiles(root: string = ROOT): string[] {
  const skip = /^(node_modules|dist|\.git|openspec)(\/|$)/;
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.de.md'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) => !skip.test(path))
    .sort();
}

// --- Language ----------------------------------------------------------------

/** Prose only: no code fences, inline code, link targets, HTML comments or bare URLs. */
export function prose(markdown: string): string {
  return withoutFences(markdown)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, '');
}

const GERMAN_WORDS = new Set(['und', 'der', 'die', 'das', 'nicht', 'mit', 'ist', 'ein', 'eine', 'für', 'auf', 'du', 'dein', 'wird']);
const ENGLISH_WORDS = new Set(['the', 'and', 'with', 'is', 'are', 'for', 'not', 'you', 'your', 'this', 'that']);

interface WordCounts {
  german: number;
  english: number;
}

/** How many German and English function words a piece of prose has. */
function countWords(text: string): WordCounts {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return {
    german: words.filter((word) => GERMAN_WORDS.has(word)).length,
    english: words.filter((word) => ENGLISH_WORDS.has(word)).length,
  };
}

/** How many German and English function words the prose of a file has. */
export function functionWords(markdown: string): WordCounts {
  return countWords(prose(markdown));
}

/**
 * The prose of a file cut at every heading, each part named by its heading.
 * Text before the first heading is named "(before the first heading)".
 */
export function proseSections(markdown: string): { heading: string; text: string }[] {
  return prose(markdown)
    .split(/^(?=#{1,6}[ \t])/m)
    .filter((part) => part.trim() !== '')
    .map((part) => {
      const heading = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(part.split('\n')[0] ?? '')?.[1];
      return { heading: heading ?? '(before the first heading)', text: part };
    });
}

/** At least this many English function words before a section or paragraph counts as English. */
const MIN_ENGLISH_WORDS = 5;

const isEnglish = ({ german, english }: WordCounts) => english >= MIN_ENGLISH_WORDS && german < 3 * english;

/**
 * Problems when the prose is not German. The whole file needs at least 20
 * German function words and three times as many as English ones. A file that
 * passes as a whole is then checked per heading section and per paragraph, so
 * a long German doc cannot hide an English section: a section or paragraph with
 * at least five English function words needs three times as many German ones.
 */
export function checkGerman(file: string, markdown: string): string[] {
  const { german, english } = functionWords(markdown);
  if (german < 20 || german < 3 * english) {
    return [`${file}: the prose is not German (${german} German and ${english} English function words; needs at least 20 and three times as many German)`];
  }
  const problems: string[] = [];
  for (const { heading, text } of proseSections(markdown)) {
    const section = countWords(text);
    if (isEnglish(section)) {
      problems.push(`${file}: section "${heading}" is not German (${section.german} German and ${section.english} English function words)`);
      continue;
    }
    for (const paragraph of text.split(/\n[ \t]*\n/)) {
      if (isEnglish(countWords(paragraph))) {
        problems.push(`${file}: section "${heading}" has an English paragraph: "${paragraph.trim().split('\n')[0]?.slice(0, 60) ?? ''}"`);
      }
    }
  }
  return problems;
}

/**
 * Problems where a German file addresses the reader with "Sie" instead of "du":
 * `Ihnen`, `Ihre`, `Ihren`, `Ihrem`, `Ihrer`, `Ihres` anywhere, and `Sie` or
 * `Ihr` after a word or a comma (polite address mid-sentence, "Prüfen Sie").
 * `Sie` at the start of a sentence or list item ("Sie prüft …") passes.
 */
export function checkInformalAddress(file: string, markdown: string): string[] {
  const problems: string[] = [];
  for (const line of prose(markdown).split('\n')) {
    for (const match of line.matchAll(/(?<![\p{L}\p{N}])(Ihnen|Ihre[mnrs]?|Sie|Ihr)(?![\p{L}\p{N}])/gu)) {
      const word = match[1] ?? '';
      const before = line.slice(0, match.index).replace(/[\s*_„"“(]+$/u, '');
      const midSentence = /[\p{L}\p{N},]$/u.test(before);
      if (word.startsWith('Ihre') || word === 'Ihnen' || midSentence) {
        problems.push(`${file}: "${line.trim()}": "${word}" is the polite address; write "du"`);
      }
    }
  }
  return problems;
}
