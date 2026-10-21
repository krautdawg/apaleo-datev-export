import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCK_FILE, displayPath, temporaryPath, withFolderLock, writeFileAtomic } from '../../src/cli/files.js';
import { UserError } from '../../src/core/errors.js';
import { createTestContext } from '../helpers/context.js';

describe('file helpers', () => {
  it('gives every write its own temporary file, ending in .tmp', () => {
    const [a, b] = [temporaryPath('/x/file.csv'), temporaryPath('/x/file.csv')];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\/x\/file\.csv\.\d+-[0-9a-f]{8}\.tmp$/);
  });

  it('leaves no temporary file behind when the rename fails', async () => {
    const ctx = createTestContext();
    ctx.fs = { ...ctx.fs, rename: () => Promise.reject(new Error('rename failed')) };
    await expect(writeFileAtomic(ctx, join(ctx.cwd, 'out', 'a.txt'), new Uint8Array([1]))).rejects.toThrow('rename failed');
    expect(readdirSync(join(ctx.cwd, 'out'))).toEqual([]);
  });

  it('holds the folder lock while the function runs, refuses a second holder and removes the lock when the function throws', async () => {
    const ctx = createTestContext();
    const dir = join(ctx.cwd, 'out');
    await expect(
      withFolderLock(ctx, dir, async () => {
        expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
        await expect(withFolderLock(ctx, dir, async () => 'second')).rejects.toBeInstanceOf(UserError);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    expect(await withFolderLock(ctx, dir, async () => 'again')).toBe('again');
  });
});

describe('displayPath', () => {
  it('is relative inside the working directory and absolute outside it', () => {
    expect(displayPath('/config', '/config/exports/BSP/a.csv')).toBe(join('exports', 'BSP', 'a.csv'));
    expect(displayPath('/config', '/data/BSP/a.csv')).toBe('/data/BSP/a.csv');
    expect(displayPath('/config', '/config/..hidden/a.csv')).toBe(join('..hidden', 'a.csv'));
  });
});
