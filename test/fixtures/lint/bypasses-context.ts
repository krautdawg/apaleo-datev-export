// Linted as if it lived in src/cli/commands: side effects must use the CommandContext.
import { env } from 'node:process';
import proc from 'process';

export async function run(): Promise<string> {
  const response = await fetch('https://api.apaleo.com/');
  const stamp = Date.now();
  const today = new Date();
  const region = process.env.TZ;
  const computed = process['env'].TZ;
  const { env: renamed } = process;
  const viaGlobal = globalThis.Date.now();
  const viaGlobalNew = new globalThis.Date();
  const globalFetch = await globalThis.fetch('https://api.apaleo.com/');
  const nowString = Date();
  return [response.status, stamp, today, region, computed, renamed, viaGlobal, viaGlobalNew, globalFetch, nowString, env, proc].join(' ');
}
