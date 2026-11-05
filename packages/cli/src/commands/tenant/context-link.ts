import type { CliContext } from '../../context/cli-context.ts';
import type { DeploymentLink } from '../../context/deployment-link.ts';

/** The invocation side of a command's client, as a link: lets lookups share the connection's retries. */
export function contextLink(context: CliContext): Pick<DeploymentLink, 'invoke'> {
  return {
    invoke: (request, options) =>
      context.client.invoke(request.action, request.input, {
        signal: options?.signal ?? context.signal,
      }),
  };
}
