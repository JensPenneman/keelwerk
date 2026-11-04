import type { HandEdit } from './hand-edit.ts';

/** The lines that tell the author what a scaffold left to a hand-written file (decision 59b). */
export function printHandEdits(edits: readonly HandEdit[]): string[] {
  return edits.flatMap((edit) => [
    `edit ${edit.file}: ${edit.reason}`,
    ...edit.lines.map((line) => `    ${line}`),
  ]);
}
