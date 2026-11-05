import { pathToFileURL } from 'node:url';
import type { CliHost } from '../context/cli-host.ts';
import type { DevPaths } from './dev-paths.ts';

/**
 * Writes `.keelwerk/dev-deployment.ts`: the project's deployment file passed through
 * `devDeployment`. Every child loads this file, so the probe, the database synchronisation and the
 * app agree on where the data lives, and `keelwerk db` can be pointed at it with `--config`.
 */
export async function writeDevDeployment(
  host: CliHost,
  paths: DevPaths,
  deploymentFile: string,
): Promise<void> {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const module = new URL(`./dev-deployment${extension}`, import.meta.url).href;
  const text = [
    `import definition from '${pathToFileURL(deploymentFile).href}';`,
    `import { devDeployment } from '${module}';`,
    '',
    `export default devDeployment(definition, ${JSON.stringify(paths)});`,
    '',
  ].join('\n');
  await host.files.writeText(paths.deployment, text, 0o644);
}
