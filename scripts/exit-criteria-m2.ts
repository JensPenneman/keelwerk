// The gate of the M2 exit criteria of docs/roadmap.md. The mapping is scripts/exit-criteria-m2.json:
// each criterion names the test files that prove it. A file counts as evidence only when it exists,
// runs at least one test, and every test in it passed: a test that is skipped or marked to-do fails
// the gate, as does a file that did not run at all. The one exception is a file whose shared suite
// skips cases by design: the criterion names its exact number of skips and the reason, so a skip
// beyond that number, or one fewer, fails until the mapping is read and changed.
//
//   node scripts/exit-criteria-m2.ts --files          the evidence files, one per line (checked by path)
//   node scripts/exit-criteria-m2.ts <report.json>    the criteria against a Vitest JSON report
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

interface Criterion {
  readonly number: number;
  readonly text: string;
  readonly evidence: readonly string[];
  /** Skips that the suite of a file makes by design: the exact number, and why. Any other skip fails. */
  readonly skips?: readonly {
    readonly file: string;
    readonly count: number;
    readonly why: string;
  }[];
}

interface Report {
  readonly testResults: readonly {
    readonly name: string;
    readonly status: string;
    readonly message?: string;
    readonly assertionResults: readonly { readonly fullName: string; readonly status: string }[];
  }[];
}

const root = new URL('../', import.meta.url);

function main(argument: string | undefined): number {
  const read = (name: string): string => readFileSync(new URL(name, root), 'utf8');
  const criteria = (JSON.parse(read('scripts/exit-criteria-m2.json')) as { criteria: Criterion[] })
    .criteria;
  const problems = mappingProblems(criteria, (path) => existsSync(new URL(path, root)));
  let out = '';
  if (problems.length === 0 && argument === '--files')
    out = `${criteria.flatMap((criterion) => criterion.evidence).join('\n')}\n`;
  else if (problems.length === 0 && argument !== undefined) {
    const result = reportOf(criteria, JSON.parse(readFileSync(argument, 'utf8')) as Report);
    problems.push(...result.problems);
    out = `${result.rows.join('\n')}\n`;
  } else if (argument === undefined)
    problems.push('usage: exit-criteria-m2.ts --files | <report.json>');
  process.stdout.write(out);
  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n`);
    return 1;
  }
  if (argument !== '--files') process.stdout.write(`\nAll ${criteria.length} criteria hold.\n`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv[2]));

/** The problems of the mapping itself: wrong numbering, a criterion without evidence, a missing file. */
export function mappingProblems(
  criteria: readonly Criterion[],
  exists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  const numbers = criteria.map((criterion) => criterion.number).join();
  if (numbers !== Array.from({ length: 11 }, (_, at) => at + 1).join())
    problems.push(`the criteria must be numbered exactly 1 to 11, found: ${numbers}`);
  for (const criterion of criteria) {
    if (criterion.evidence.length === 0)
      problems.push(`criterion ${criterion.number} has no evidence`);
    for (const path of criterion.evidence)
      if (!exists(path)) problems.push(`criterion ${criterion.number}: no file ${path}`);
    for (const skip of criterion.skips ?? [])
      if (!criterion.evidence.includes(skip.file) || skip.count < 1)
        problems.push(
          `criterion ${criterion.number}: skips name ${skip.file}, not an evidence file or no skip`,
        );
  }
  return problems;
}

/** The report lines and problems of a Vitest JSON report against the criteria. */
export function reportOf(
  criteria: readonly Criterion[],
  report: Report,
): { readonly rows: string[]; readonly problems: string[] } {
  const rows: string[] = [];
  const problems: string[] = [];
  for (const criterion of criteria) {
    let passed = 0;
    let skips = 0;
    for (const path of criterion.evidence) {
      const file = report.testResults.find((result) => result.name.endsWith(`/${path}`));
      if (file === undefined) {
        problems.push(`criterion ${criterion.number}: ${path} did not run`);
        continue;
      }
      if (file.assertionResults.length === 0)
        problems.push(`criterion ${criterion.number}: ${path} runs no test (${file.status})`);
      const skipped: string[] = [];
      for (const test of file.assertionResults) {
        if (test.status === 'passed') passed += 1;
        else if (test.status === 'skipped') skipped.push(test.fullName);
        else
          problems.push(`criterion ${criterion.number}: ${path}: ${test.status}: ${test.fullName}`);
      }
      const allowed = criterion.skips?.find((skip) => skip.file === path)?.count ?? 0;
      if (skipped.length !== allowed)
        problems.push(
          `criterion ${criterion.number}: ${path}: ${skipped.length} skipped, ${allowed} allowed${skipped[0] === undefined ? '' : ` (first: ${skipped[0]})`}`,
        );
      skips += skipped.length;
    }
    const files = criterion.evidence.length;
    rows.push(
      `${String(criterion.number).padStart(2)}  ${files} files, ${passed} tests passed, ${skips} skipped by design  ${criterion.text}`,
    );
  }
  return { rows, problems };
}
