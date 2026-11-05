// Prints the M1 exit criteria of docs/roadmap.md with the CI job and step that proves each. The
// mapping is scripts/exit-criteria.json; every job and step it names must exist in
// .github/workflows/ci.yml, so a renamed step cannot leave a criterion unproven. Exits 1 on a
// criterion without proof or a proof that names a missing job or step.
//
//   node scripts/exit-criteria.ts
import { readFileSync } from 'node:fs';
import process from 'node:process';

interface Proof {
  readonly job: string;
  readonly step: string;
}

interface Criterion {
  readonly number: number;
  readonly text: string;
  readonly decided?: string;
  readonly proofs: readonly Proof[];
}

const read = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

const criteria = (JSON.parse(read('scripts/exit-criteria.json')) as { criteria: Criterion[] })
  .criteria;
const workflow = read('.github/workflows/ci.yml');

/** The text of one job of the workflow: from its key to the next job key. */
function jobText(job: string): string | undefined {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, at) => at > start && /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

const problems: string[] = [];
const numbers = criteria.map((criterion) => criterion.number).join();
if (numbers !== Array.from({ length: 12 }, (_, at) => at + 1).join())
  problems.push(`the criteria must be numbered exactly 1 to 12, found: ${numbers}`);
const rows: string[] = [];
for (const criterion of criteria) {
  if (criterion.proofs.length === 0) problems.push(`criterion ${criterion.number} has no proof`);
  const proofs = criterion.proofs.map((proof) => {
    const text = jobText(proof.job);
    if (text === undefined) problems.push(`criterion ${criterion.number}: no job ${proof.job}`);
    else if (!text.includes(`- name: ${proof.step}\n`))
      problems.push(`criterion ${criterion.number}: no step "${proof.step}" in job ${proof.job}`);
    return `${proof.job} / ${proof.step}`;
  });
  const decided = criterion.decided === undefined ? '' : ` [decided: ${criterion.decided}]`;
  rows.push(`${String(criterion.number).padStart(2)}  ${criterion.text}${decided}`);
  for (const proof of proofs) rows.push(`      proved by ${proof}`);
}

process.stdout.write(`${rows.join('\n')}\n`);
if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${criteria.length} criteria map to a step of the workflow.\n`);
