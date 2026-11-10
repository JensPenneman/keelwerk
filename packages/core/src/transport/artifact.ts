export type Artifact =
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly contentType: string;
      readonly content: string;
    }
  /** Merged into `keelwerk.generated.ts`: `content` is the declaration, `module` and `names` its type import (S-128). */
  | {
      readonly kind: 'type-fragment';
      readonly content: string;
      readonly module?: string;
      readonly names?: readonly string[];
    };
