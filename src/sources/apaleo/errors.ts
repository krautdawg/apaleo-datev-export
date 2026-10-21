import { UserError } from '../../core/errors.js';

/**
 * Fine-grained permissions the apaleo custom app needs. The 403 message and the
 * setup docs print this same list.
 */
export const APALEO_PERMISSIONS = {
  required: ['core.subledger_schema.read', 'core.subledger_export.create', 'core.properties.read'],
  optional: ['core.subledger_aggregate.create'],
  scopeAlternative: 'accounting.read',
} as const;

export function describePermissions(): string {
  const { required, optional, scopeAlternative } = APALEO_PERMISSIONS;
  return [
    'The apaleo custom app needs these permissions (apaleo: Apps > Connected apps > your app):',
    `  required: ${required.join(', ')}`,
    `  optional: ${optional.join(', ')} (only for the aggregate completeness check)`,
    `Clients that use scopes instead of permissions need the scope ${scopeAlternative}.`,
  ].join('\n');
}

/** Any failure talking to apaleo. The message never contains the client secret or a token. */
export class ApaleoError extends UserError {
  override readonly name: string = 'ApaleoError';

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** HTTP 403: the custom app lacks a permission. */
export class ApaleoPermissionError extends ApaleoError {
  override readonly name: string = 'ApaleoPermissionError';

  constructor(what: string) {
    super(`apaleo refused ${what} (HTTP 403 Forbidden).\n${describePermissions()}`, 403);
  }
}

export const CREDENTIALS_HINT =
  'Check apaleo.clientId (or APALEO_CLIENT_ID) and APALEO_CLIENT_SECRET, and that the custom app is active ' +
  'under Apps > Connected apps in apaleo.';

/** Replaces every occurrence of the given secrets with `***`. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) result = result.split(secret).join('***');
  }
  return result;
}
