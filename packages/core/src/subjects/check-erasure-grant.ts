import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { forbiddenError } from '../authorization/forbidden-error.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { ownsSubject } from './owns-subject.ts';

/**
 * The ownership check of `core.eraseSubject` (section 14.7.5), run by `acceptAsyncCommand` inside
 * its unit once the gate has allowed the call, before the job is written. A rule of the core or of
 * the app (the operators' rule, a `policies.add` or `policies.replace` rule) grants the erasure of
 * any subject of the tenant. A rule a module contributed to the core grants it only for a subject
 * the contributing module holds a live row of in this tenant (`ownsSubject`): without that, a
 * module with no row of the subject could erase it, and so could one that holds rows of another
 * tenant's subject. An unknown subject, another tenant's subject and a subject nobody owns all get
 * the same answer, and the unit rolls back with nothing written.
 */
export async function checkErasureGrant(unit: Unit, input: RunCommandInput): Promise<void> {
  const { subjectId } = input.input as { readonly subjectId: string };
  const verdict = evaluateGate({
    rules: input.rules,
    action: input.action,
    context: principalContextOf(input.registry, input.principal, input.scope, input.flags),
    transport: input.request.transport,
    input: input.input,
  });
  const denial = {
    rules: verdict.rules,
    reason:
      'No rule that allows this erasure comes from a module that holds a row of this subject in this tenant.',
    action: input.action.ref,
  };
  if (!verdict.allowed) throw forbiddenError({ ...denial, reason: verdict.reason });
  const contributors = new Set<string>();
  for (const match of verdict.rules) {
    const entry = input.rules.find((rule) => rule.id === match.id)?.entry;
    if (entry?.contributedBy === undefined) return;
    contributors.add(entry.contributedBy);
  }
  for (const module of contributors) {
    if (await ownsSubject(unit, input.registry, module, subjectId)) return;
  }
  throw forbiddenError(denial);
}
