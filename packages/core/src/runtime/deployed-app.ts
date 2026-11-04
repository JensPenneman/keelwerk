import type { SurfaceSource } from '../surface/surface-source.ts';

/** An app of the deployment's catalogue as `defineApp` returned it (section 4.5): the value the surface is derived from. */
export interface DeployedApp extends SurfaceSource {}
