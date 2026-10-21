import { UserError } from '../core/errors.js';
import { formatFinding, type Finding } from '../core/findings.js';

/** Every problem of one batch at once, so the user can fix them in one pass. */
export class ExtfValidationError extends UserError {
  override readonly name: string = 'ExtfValidationError';

  constructor(readonly findings: readonly Finding[]) {
    const lines = findings.map((finding) => `  - ${formatFinding(finding)}`);
    super(`The DATEV file was not written (${findings.length} problem${findings.length === 1 ? '' : 's'}):\n${lines.join('\n')}`);
  }
}
