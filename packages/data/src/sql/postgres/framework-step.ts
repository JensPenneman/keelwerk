/** One step of the framework track (S-117). */
export interface FrameworkStep {
  /** `kw_migrations.id`: '0001', '0002'. */
  readonly id: string;
  /**
   * The relation whose presence proves the step ran, for a history that lacks its row. A name that
   * no relation carries (step 0006) means the step runs again whenever its row is missing, so a later
   * step that changes the same policies must also run again after a truncate, or the rerun of the
   * older one undoes it.
   */
  readonly marker: string;
  /** Tables, indexes and policies for `root`; rendered at the template root, what the checksum covers. */
  ddl(root: string, options: { readonly control?: boolean }): readonly string[];
  /** The application role's grants on the step's tables; outside the checksum. */
  grants(root: string, role: string, options: { readonly control?: boolean }): readonly string[];
}
