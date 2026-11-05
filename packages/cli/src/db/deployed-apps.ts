import type { SurfaceSource } from '@keelwerk/core';

/** An app of the deployment's catalogue as the data commands need it: the value with its composed registry. */
export function deployedApps(apps: readonly { readonly id: string }[]): readonly SurfaceSource[] {
  return apps.filter(
    (app): app is SurfaceSource =>
      typeof app === 'object' &&
      app !== null &&
      'registry' in app &&
      typeof app.registry === 'object' &&
      app.registry !== null &&
      'modules' in app &&
      Array.isArray(app.modules),
  );
}
