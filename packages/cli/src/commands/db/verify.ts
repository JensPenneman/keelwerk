import { verifyAnchors } from '@keelwerk/core';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { ledgerSinksOf } from '../../db/ledger-sinks-of.ts';
import { openDeployment } from '../../db/open-deployment.ts';
import { scopeTargetsOf } from '../../db/scope-targets-of.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { dbFlags } from './db-flags.ts';
import { deploymentPathOf } from './deployment-path-of.ts';

/**
 * `db verify` (sections 14.6.4 and 15.1.8): compares every scope's chain with the anchors in the
 * deployment's ledger sinks. The event at each anchored position must exist with the anchored hash
 * and the scope's head must be at or past its newest anchor, so a database rewound behind its
 * newest anchor is found. Any finding exits 1.
 */
export const dbVerifyCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Compare the chains with the anchors in the ledger sinks.',
    fullDescription:
      'db verify   a missing event, a changed hash or a head behind its newest anchor fails',
  },
  parameters: { flags: dbFlags({}, true) } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const opened = await openDeployment(deploymentPathOf(scoped, 'verify'), scoped.host.env);
      try {
        const sinks = ledgerSinksOf(opened.definition.infrastructure);
        const verdict = await verifyAnchors(sinks, scopeTargetsOf(opened));
        if (scoped.output.format === 'text' || scoped.output.format === 'table') {
          if (sinks.length === 0)
            scoped.output.note('the deployment lists no ledger sink, so nothing is anchored');
          for (const finding of verdict.findings) {
            scoped.output.note(`${finding.kind} ${finding.scopeId}: ${JSON.stringify(finding)}`);
          }
          for (const scopeId of verdict.unresolved) {
            scoped.output.note(
              `unresolved ${scopeId}: the control store does not serve this scope`,
            );
          }
          if (verdict.findings.length === 0) {
            scoped.output.line(`${verdict.checked} anchors verified`);
          }
        } else {
          scoped.output.value(verdict);
        }
        if (verdict.findings.length > 0) scoped.process.exitCode = 1;
      } finally {
        await opened.close();
      }
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
