/**
 * The text of one job of a workflow: from the line `  <key>:` up to the next line that starts with
 * two spaces and a non-space, or the end. Throws Error(`no job ${key}`) when the key is missing.
 */
export function workflowJob(workflow: string, key: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${key}:`);
  if (start === -1) {
    throw new Error(`no job ${key}`);
  }
  const end = lines.findIndex((line, at) => at > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}
