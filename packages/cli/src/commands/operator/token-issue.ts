import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { operatorFlags } from './operator-flags.ts';
import { runOperatorAction } from './run-operator-action.ts';
import { textFlag } from './text-flag.ts';

/**
 * `operator token issue --label <text> [--ttl 12h]` (section 3.5): a short-lived operator token
 * for a remote profile. The token is printed once; the deployment keeps only a verifier.
 */
export const tokenIssueCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Issue an operator token for a remote profile.',
    fullDescription:
      'The token expires after 12 hours unless --ttl says otherwise (1 minute to 30 days). It is shown once.',
  },
  parameters: {
    flags: {
      ...operatorFlags(),
      label: textFlag('What the token is for, shown by `token list`.', 'text'),
      ttl: textFlag('How long it lives: 45m, 12h, 7d or an ISO 8601 duration.', 'duration'),
    },
  } as never,
  async func(this: CliContext, parsed) {
    const label = typeof parsed.label === 'string' ? parsed.label : 'cli';
    const ttl = typeof parsed.ttl === 'string' ? { ttl: parsed.ttl } : {};
    await runOperatorAction(this, parsed, 'core.operatorToken.issue', { label, ...ttl });
  },
});
