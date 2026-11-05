/**
 * The project root of a deployment file (S-115, sections 13.6 and 16.9.1): the directory that holds
 * the project, which is the file's directory, or its parent for `.launchway/deployment.ts`. The
 * deployment file is the nearest `keelwerk.config.ts` or `.launchway/deployment.ts` from the
 * working directory (or the one `--config` names), so `keelwerk dev` keeps its state below the
 * same directory the project connection looks in for `.keelwerk/dev.sock`.
 */
export function projectRootOf(deploymentFile: string): string {
  const directory = deploymentFile.slice(0, Math.max(deploymentFile.lastIndexOf('/'), 0));
  return directory.endsWith('/.launchway') ? directory.slice(0, -'/.launchway'.length) : directory;
}
