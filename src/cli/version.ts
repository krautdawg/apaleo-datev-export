import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** `package.json` sits two levels up from both `src/cli` and `dist/cli`. */
export const VERSION: string = (require('../../package.json') as { version: string }).version;
