import type { CliContext } from '../../context/cli-context.ts';
import { planScaffold } from '../../scaffold/plan-scaffold.ts';
import { printHandEdits } from '../../scaffold/print-hand-edits.ts';
import { writeScaffold } from '../../scaffold/write-scaffold.ts';
import type { NewFlags } from './new-flags.ts';
import { prepareRequest } from './prepare-request.ts';

/** Plans one scaffold, writes its files unless `--dry-run`, and prints what is left to hand edits. */
export async function runNew(
  context: CliContext,
  kind: string,
  reference: string,
  flags: NewFlags,
): Promise<void> {
  const { cwd } = context.host;
  const request = await prepareRequest(cwd, kind, reference, flags);
  const plan = planScaffold(request);
  const dry = flags['dry-run'] === true;
  if (!dry) {
    await writeScaffold(cwd, plan.files);
  }
  for (const file of plan.files) {
    context.output.line(`${dry ? 'would create' : 'create'} ${file.path}`);
  }
  for (const line of printHandEdits(plan.handEdits)) {
    context.output.line(line);
  }
}
