/** The queries the runtime answers itself: their handlers cannot see the app's surface (WP-33). */
export const runtimeAnswered: ReadonlySet<string> = new Set([
  'core.introspect',
  'core.composition',
]);
