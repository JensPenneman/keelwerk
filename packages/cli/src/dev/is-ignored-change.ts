const ignoredDirectories = new Set(['node_modules', 'dist', 'generated', '.keelwerk', '.git']);

/**
 * Whether a change below the workspace is one the supervisor must not react to (section 13.6):
 * `node_modules`, `dist`, `generated` and `.keelwerk` directories, the `*.generated.ts` files the
 * producers write themselves, the manifest writer's `*.tmp` file and the compiler's build info.
 */
export function isIgnoredChange(path: string): boolean {
  const parts = path.split('/');
  const file = parts.at(-1) ?? '';
  return (
    parts.some((part) => ignoredDirectories.has(part)) ||
    file.endsWith('.generated.ts') ||
    file.endsWith('.tmp') ||
    file.endsWith('.tsbuildinfo') ||
    file.endsWith('~') ||
    file.startsWith('.#')
  );
}
