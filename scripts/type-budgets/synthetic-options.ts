/** How a synthetic workspace is written beyond its module count. */
export interface SyntheticOptions {
  /** Adds the real `@keelwerk/live` (its declarations) to the app, so every entity gets `watch`. */
  readonly live?: boolean;
}
