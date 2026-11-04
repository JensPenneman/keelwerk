import type { ApiSurface } from '../surface/api-surface.ts';
import type { Artifact } from './artifact.ts';
import type { MountContext } from './mount-context.ts';
import type { MountHandle } from './mount-handle.ts';
import type { TransportCapabilities } from './transport-capabilities.ts';
import type { TransportProblem } from './transport-problem.ts';

/** A name, capabilities, a pure `artifacts` function and a `mount` function (section 16.3.2). */
export interface TransportAdapter<Static = unknown, Config = unknown> {
  /** 'rest', 'graphql', 'trpc', 'cli', 'webhooks'. */
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  /** Fixed when the module value is built. */
  readonly static: Static;
  /** Pure. What this transport cannot project, as named problems. */
  check(surface: ApiSurface): readonly TransportProblem[];
  /** Pure: the same surface and static options give byte-identical artefacts. */
  artifacts(surface: ApiSurface): readonly Artifact[];
  /** Runs once per app at `listen`; registers routes on the host and returns a handle for shutdown. */
  mount(ctx: MountContext<Config>): Promise<MountHandle>;
}
