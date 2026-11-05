import { locateFile } from './file-location.ts';
import { importAndEntry } from './import-and-entry.ts';
import type { LayoutFinding } from './layout-finding.ts';
import type { AppRoot } from './layout-workspace.ts';

const APP_DIRECTORIES: ReadonlyMap<string, string> = new Map([
  ['actions', 'actions'],
  ['flags', 'flags'],
  ['policies', 'rules'],
  ['versions', 'versions'],
]);

/** An app-level part (action, flag, rule, version change) that `app.ts` does not mount. */
export function appMountFindings(app: AppRoot): readonly LayoutFinding[] {
  const entry = app.sources.get('app.ts');
  if (entry === undefined) return [];
  const findings: LayoutFinding[] = [];
  for (const [file, source] of app.sources) {
    const { directory } = locateFile(file);
    const property = directory === undefined ? undefined : APP_DIRECTORIES.get(directory);
    const name = source.values[0]?.name;
    if (property === undefined || name === undefined || entry.referenced.has(name)) continue;
    findings.push({
      kind: 'mounts',
      path: `${app.dir}/src/${file}`,
      message: `${file} is an app-level part that app.ts does not mount`,
      fix: importAndEntry(
        `${app.dir}/src/app.ts`,
        `${app.dir}/src/${file}`,
        name,
        `${property} in app.ts`,
      ),
    });
  }
  return findings;
}
