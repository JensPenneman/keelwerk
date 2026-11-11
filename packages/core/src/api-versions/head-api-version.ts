import type { ApiVersions } from '../dsl/define-api-versions.ts';

/** The newest API version an app serves: its last declared date, else its head. */
export function headApiVersion(app: {
  readonly head: string;
  readonly api?: ApiVersions | null | undefined;
}): string {
  return (app.api?.dates ?? [app.head]).at(-1) ?? app.head;
}
