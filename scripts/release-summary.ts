import type { PublishRow } from './publish-row.ts';

/**
 * Markdown for $GITHUB_STEP_SUMMARY and stdout: the heading 'keelwerk <version>: <mode>[, dry run]',
 * a table in publish order, what the owner does when any row is staged (approval is the owner's
 * second factor, on the website), and the acceptance line.
 */
export function releaseSummary(input: {
  readonly version: string;
  readonly mode: 'staged' | 'trusted';
  readonly dryRun: boolean;
  readonly rows: readonly PublishRow[];
}): string {
  const lines = [
    `## keelwerk ${input.version}: ${input.mode}${input.dryRun ? ', dry run' : ''}`,
    '',
    '| Package | Version | Provenance | Outcome | Stage id |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const row of input.rows) {
    const outcome = row.detail === undefined ? row.outcome : `${row.outcome}: ${row.detail}`;
    lines.push(
      `| ${row.name} | ${row.version} | on | ${outcome.replaceAll('|', '/')} | ${row.stageId ?? ''} |`,
    );
  }
  const waiting = input.rows.filter(
    (row) => row.outcome === 'staged' || row.outcome === 'already staged',
  );
  if (waiting.length > 0) {
    lines.push(
      '',
      "Approve the staged versions on npm's Staged Packages page in one batch, confirmed with your second factor (npm stage approve needs a terminal and cannot run here). Stage ids in publish order:",
    );
    for (const row of waiting) {
      lines.push(
        row.stageId === undefined
          ? `- ${row.name}: npm stage list ${row.name}`
          : `- ${row.name}: ${row.stageId}`,
      );
    }
  }
  lines.push(
    '',
    `After approval: npm audit signatures in a fresh project that pins every package at ${input.version}.`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Markdown for $GITHUB_STEP_SUMMARY when the run stopped before anything was staged: the heading,
 * the reason and every package as not attempted.
 */
export function stoppedSummary(input: {
  readonly version: string;
  readonly mode: 'staged' | 'trusted';
  readonly dryRun: boolean;
  readonly message: string;
  readonly names: readonly string[];
}): string {
  const lines = [
    `## keelwerk${input.version === '' ? '' : ` ${input.version}`}: ${input.mode}${input.dryRun ? ', dry run' : ''}`,
    '',
    `stopped before anything was staged: ${input.message}`,
    '',
    '| Package | Outcome |',
    '| --- | --- |',
    ...input.names.map((name) => `| ${name} | not attempted |`),
  ];
  return `${lines.join('\n')}\n`;
}
