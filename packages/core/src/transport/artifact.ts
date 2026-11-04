export type Artifact =
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly contentType: string;
      readonly content: string;
    }
  /** Merged into `keelwerk.generated.ts`. */
  | { readonly kind: 'type-fragment'; readonly content: string };
