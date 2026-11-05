/** Thrown inside the unit of a dry run so the adapter rolls it back; `dryRun` catches it. */
export class DryRunRollback extends Error {
  constructor() {
    super('the dry run rolled its unit back');
    this.name = 'DryRunRollback';
  }
}
