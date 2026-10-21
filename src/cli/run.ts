import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { UsageError, UserError } from '../core/errors.js';
import {
  COMMON_OPTIONS,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  type Command, type CommandArgs, type OptionSpec } from './command.js';
import { COMMANDS } from './commands/index.js';
import type { CommandContext } from './context.js';
import { BIN, renderCommandHelp, renderHelp } from './help.js';
import { VERSION } from './version.js';

/**
 * Runs the CLI in-process and returns the exit code: 0 success,
 * 1 runtime or validation failure, 2 usage error.
 */
export async function runCli(
  argv: readonly string[],
  ctx: CommandContext,
  commands: readonly Command[] = COMMANDS,
): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') {
    ctx.stdout.write(renderHelp(commands));
    return EXIT_OK;
  }
  if (first === '--version') {
    ctx.stdout.write(`${VERSION}\n`);
    return EXIT_OK;
  }

  const command = commands.find((c) => c.name === first);
  if (!command) {
    const what = first.startsWith('-') ? `Unknown option "${first}"` : `Unknown command "${first}"`;
    return usageError(ctx, `${what}. Run "${BIN} --help" for the list of commands.`);
  }

  let args: CommandArgs;
  try {
    args = parseCommandArgs(command, rest);
  } catch (error) {
    return usageError(ctx, `${(error as Error).message}\nRun "${BIN} ${command.name} --help" for its options.`);
  }
  if (args.values.help === true) {
    ctx.stdout.write(renderCommandHelp(command));
    return EXIT_OK;
  }

  try {
    return await command.run(args, ctx);
  } catch (error) {
    if (error instanceof UsageError) return usageError(ctx, error.message);
    reportFailure(ctx, error, args.values.debug === true);
    return EXIT_FAILURE;
  }
}

function parseCommandArgs(command: Command, args: string[]): CommandArgs {
  const { values, positionals } = parseArgs({
    args,
    options: toParseArgsOptions({ ...command.options, ...COMMON_OPTIONS }),
    allowPositionals: command.allowPositionals ?? false,
    strict: true,
  });
  return { values, positionals };
}

function toParseArgsOptions(options: Record<string, OptionSpec>): ParseArgsOptionsConfig {
  const result: ParseArgsOptionsConfig = {};
  for (const [name, { type, short, multiple }] of Object.entries(options)) {
    result[name] = { type, ...(short ? { short } : {}), ...(multiple ? { multiple } : {}) };
  }
  return result;
}

function usageError(ctx: CommandContext, message: string): number {
  ctx.stderr.write(`Error: ${message}\n`);
  return EXIT_USAGE;
}

function reportFailure(ctx: CommandContext, error: unknown, debug: boolean): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const prefix = err instanceof UserError ? 'Error' : 'Unexpected error';
  ctx.stderr.write(`${prefix}: ${err.message}\n`);
  if (debug && err.stack) ctx.stderr.write(`${err.stack}\n`);
  else if (!(err instanceof UserError)) ctx.stderr.write('Run again with --debug to see the stack trace.\n');
}
