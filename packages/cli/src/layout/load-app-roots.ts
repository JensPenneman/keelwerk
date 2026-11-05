import { appRootPatterns } from './app-root-patterns.ts';
import type { AppRoot } from './layout-workspace.ts';
import { parseSources } from './parse-sources.ts';

function below(files: readonly string[], prefix: string): readonly string[] {
  return files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
}

/** The app roots among `files`: a matching directory with `src/app.ts`. */
export async function loadAppRoots(
  root: string,
  files: readonly string[],
): Promise<readonly AppRoot[]> {
  const apps: AppRoot[] = [];
  for (const file of files.filter((candidate) => candidate.endsWith('/src/app.ts'))) {
    const dir = file.slice(0, -'/src/app.ts'.length);
    if (!appRootPatterns.some((pattern) => pattern.test(dir))) continue;
    const source = below(files, `${dir}/src/`);
    apps.push({ dir, files: source, sources: await parseSources(root, `${dir}/src`, source) });
  }
  return apps;
}
