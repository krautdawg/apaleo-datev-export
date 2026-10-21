// Linted as if it lived in src/cli/commands: the allowed way.
import type { CommandContext } from '../../cli/context.js';

export async function run(ctx: CommandContext): Promise<string> {
  const response = await ctx.fetchFn('https://api.apaleo.com/');
  const parsed = new Date('2026-10-20T00:00:00Z');
  return `${response.status} ${ctx.now().toISOString()} ${parsed.getTime()} ${ctx.env.TZ}`;
}
