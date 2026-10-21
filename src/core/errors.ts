/**
 * An error the user can fix (bad config, missing file, unmapped account).
 * The CLI prints its message without a stack trace and exits with code 1.
 */
export class UserError extends Error {
  override readonly name: string = 'UserError';
}

/**
 * Wrong command line usage (unknown command or flag). The CLI exits with code 2.
 */
export class UsageError extends Error {
  override readonly name: string = 'UsageError';
}

/** Where users report problems that they cannot fix themselves. */
export const ISSUES_URL = 'https://github.com/krautdawg/apaleo-datev-export/issues';

/**
 * The next step for an error that neither a change in apaleo nor in the config
 * can fix: report it, without personal data.
 */
export const REPORT_PROBLEM_HINT =
  `This cannot be fixed in apaleo or in your config. Please open an issue at ${ISSUES_URL} ` +
  'and paste this message, but leave out guest names.';
