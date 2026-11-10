/** What happened to one package of the release. */
export interface PublishRow {
  readonly name: string;
  readonly version: string;
  readonly outcome:
    | 'dry run'
    | 'staged'
    | 'already published'
    | 'already staged'
    | 'failed'
    | 'not attempted';
  readonly stageId?: string;
  /** npm's last output line on failure, or a hint. */
  readonly detail?: string;
}
