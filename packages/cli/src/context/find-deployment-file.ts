import type { CliHost } from './cli-host.ts';

function parentOf(directory: string): string | undefined {
  const cut = directory.lastIndexOf('/');
  if (cut < 0 || directory === '/') {
    return undefined;
  }
  return cut === 0 ? '/' : directory.slice(0, cut);
}

function join(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory}/${name}`;
}

/**
 * The deployment file of project mode (section 16.9.1): `--config`, then `KEELWERK_CONFIG`, then the
 * nearest `keelwerk.config.ts` in the working directory or an ancestor, with `.launchway/deployment.ts`
 * of the same directory as the fallback there.
 */
export async function findDeploymentFile(
  host: CliHost,
  explicit?: string,
): Promise<string | undefined> {
  const named = explicit ?? host.env.KEELWERK_CONFIG;
  if (named !== undefined && named !== '') {
    return named.startsWith('/') ? named : join(host.cwd, named);
  }
  let directory: string | undefined = host.cwd;
  while (directory !== undefined) {
    for (const candidate of ['keelwerk.config.ts', '.launchway/deployment.ts']) {
      const path = join(directory, candidate);
      if (await host.files.exists(path)) {
        return path;
      }
    }
    directory = parentOf(directory);
  }
  return undefined;
}
