import type { DeploymentLink } from '../context/deployment-link.ts';

/** A link to a deployment and what ends it: the in-process runtime of project mode stops, a socket or a remote has nothing to close. */
export interface OpenedConnection {
  readonly link: DeploymentLink;
  close(): Promise<void>;
}
