/**
 * The compose seam (section 3.3). `defineApp` hands the app value it built to `composeApp`, which
 * derives the registry, the surface and the runtime mirror of the composition checks. Until the
 * composer exists the seam returns the app unchanged.
 */
export function composeApp<A extends { readonly kind: 'app' }>(app: A): A {
  return app;
}
