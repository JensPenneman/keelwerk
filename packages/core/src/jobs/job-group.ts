/** A concurrency and rate group shared by jobs (section 9.5.5). */
export interface JobGroup {
  readonly id: string;
  readonly concurrency?: number;
  readonly rate?: string;
  readonly scope?: 'namespace' | 'deployment';
}
