import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { UserError } from '../core/errors.js';
import type { CommandContext } from './context.js';

/** A path for output: relative to `cwd` when inside it, else absolute (`/data/...` in the container, not `../data/...`). */
export function displayPath(cwd: string, path: string): string {
  const inside = relative(cwd, path);
  return inside.split(sep)[0] === '..' || isAbsolute(inside) ? path : inside;
}

/** The file's bytes, or undefined when it does not exist. */
export async function readIfExists(ctx: CommandContext, path: string): Promise<Uint8Array | undefined> {
  try {
    return await ctx.fs.readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * A temporary file beside `path`, unique to this call, so two runs never write
 * the same temporary file. It ends in `.tmp`, which no export file name matches.
 */
export function temporaryPath(path: string): string {
  return `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
}

/** Writes through a temporary file and a rename, so an interrupted run never leaves half a file. */
export async function writeFileAtomic(ctx: CommandContext, path: string, bytes: Uint8Array): Promise<void> {
  await ctx.fs.mkdir(dirname(path), { recursive: true });
  const temporary = temporaryPath(path);
  try {
    await ctx.fs.writeFile(temporary, bytes);
    await ctx.fs.rename(temporary, path);
  } catch (error) {
    await ctx.fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export const LOCK_FILE = '.apaleo-datev.lock';

/**
 * Runs `fn` while holding `<dir>/.apaleo-datev.lock`, created exclusively, so
 * only one run at a time changes the files of that folder. Another run that
 * finds the lock stops with a `UserError` instead of waiting. The lock is
 * removed when `fn` ends, also when it throws.
 */
export async function withFolderLock<T>(ctx: CommandContext, dir: string, fn: () => Promise<T>): Promise<T> {
  await ctx.fs.mkdir(dir, { recursive: true });
  const lock = join(dir, LOCK_FILE);
  try {
    await ctx.fs.writeFile(lock, `pid ${process.pid} at ${ctx.now().toISOString()}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new UserError(
      `another apaleo-datev run is writing into ${dir} (the lock file ${lock} exists). Nothing was written; run again when it has finished. ` +
        'If no other run is active, a run was interrupted while writing: delete the lock file and run again',
    );
  }
  try {
    return await fn();
  } finally {
    await ctx.fs.rm(lock, { force: true });
  }
}

/** True when something exists at `path`. */
export async function pathExists(ctx: CommandContext, path: string): Promise<boolean> {
  try {
    await ctx.fs.stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Replaces `path` with `bytes` and keeps the old file as `backup`: the new
 * content goes to a temporary file first, then the original moves to the backup
 * and the temporary file into place. Refuses when the backup exists, so it is
 * never overwritten. If a step fails, the original stays at (or is moved back
 * to) `path`.
 */
export async function replaceKeepingBackup(ctx: CommandContext, path: string, backup: string, bytes: Uint8Array): Promise<void> {
  if (await pathExists(ctx, backup)) {
    throw new UserError(`${backup} already exists; move or rename it and run again. ${path} was not changed.`);
  }
  const temporary = temporaryPath(path);
  try {
    await ctx.fs.writeFile(temporary, bytes);
  } catch (error) {
    await ctx.fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await ctx.fs.rename(path, backup);
  try {
    await ctx.fs.rename(temporary, path);
  } catch (error) {
    await ctx.fs.rename(backup, path).catch(() => {
      throw new UserError(`Could not write ${path}; the original file is now ${backup}.`, { cause: error });
    });
    throw error;
  }
}
