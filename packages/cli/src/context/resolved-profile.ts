/**
 * The connection a command runs against (section 16.9.1): a remote deployment, the operator
 * socket, the project's own definitions, or none yet.
 */
export interface ResolvedProfile {
  readonly kind: 'remote' | 'socket' | 'project' | 'none';
  /** The profile's name, absent for `--socket` and the project. */
  readonly name?: string;
  /** `https://...`, `http://` to loopback, or `unix://...`. */
  readonly url?: string;
  readonly socketPath?: string;
  readonly backend?: string;
  readonly tenant?: string;
  readonly token?: string;
  /** The deployment file of project mode. */
  readonly configPath?: string;
}
