import type { Command, OptionSpec } from './command.js';
import { COMMON_OPTIONS } from './command.js';
import { VERSION } from './version.js';

export const BIN = 'apaleo-datev';
const DISCLAIMER_LINE =
  'No warranty, not tax advice: have your Steuerberater check the mapping and the first imports. See DISCLAIMER.md.';

export function renderHelp(commands: readonly Command[]): string {
  const width = Math.max(15, ...commands.map((c) => c.name.length + 2));
  return [
    `${BIN} ${VERSION} - export apaleo accounting data to DATEV-Format (EXTF) files`,
    '',
    `Usage: ${BIN} <command> [options]`,
    '',
    'Commands:',
    ...commands.map((c) => `  ${c.name.padEnd(width)}${c.summary}`),
    '',
    'Options:',
    `  ${'-h, --help'.padEnd(width)}Show this help`,
    `  ${'--version'.padEnd(width)}Show the version`,
    '',
    `Run "${BIN} <command> --help" for the options of a command.`,
    '',
    DISCLAIMER_LINE,
    '',
  ].join('\n');
}

export function renderCommandHelp(command: Command): string {
  const options = { ...command.options, ...COMMON_OPTIONS };
  const labels = Object.entries(options).map(([name, spec]) => [optionLabel(name, spec), spec.description] as const);
  const width = Math.max(...labels.map(([label]) => label.length)) + 2;
  return [
    `Usage: ${BIN} ${command.name} ${command.usage}`.trimEnd(),
    '',
    command.summary,
    '',
    'Options:',
    ...labels.map(([label, description]) => `  ${label.padEnd(width)}${description}`),
    '',
  ].join('\n');
}

function optionLabel(name: string, spec: OptionSpec): string {
  const long = `--${name}${spec.type === 'string' ? ` ${spec.valueName ?? '<value>'}` : ''}`;
  return spec.short ? `-${spec.short}, ${long}` : long;
}
