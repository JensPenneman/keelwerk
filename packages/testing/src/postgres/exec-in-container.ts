import { getContainerRuntimeClient } from 'testcontainers';

/**
 * Runs a command inside a running container by its id (the client tools of the PostgreSQL image, for
 * a test that backs a database up and restores it), so a test shares the cluster of the project's
 * global setup instead of starting a container of its own. Answers its exit code and its output.
 * `user` runs the command as that user of the container (default: the image's, root for
 * PostgreSQL's).
 */
export async function execInContainer(
  containerId: string,
  command: readonly string[],
  options: { readonly user?: string } = {},
): Promise<{ readonly exitCode: number; readonly output: string }> {
  const client = await getContainerRuntimeClient();
  const result = await client.container.exec(client.container.getById(containerId), [...command], {
    ...(options.user === undefined ? {} : { user: options.user }),
  });
  return { exitCode: result.exitCode, output: result.output };
}
