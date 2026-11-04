/**
 * Which view of a row: `own` (the declaring module: hidden fields included), `dependency` (another
 * module's row: hidden fields excluded) and `readable` (as a caller may read it: hidden fields
 * excluded, maskable fields optional; `Readable<App, 'module.entity'>` of section 8.1).
 */
export type RowView = 'own' | 'dependency' | 'readable';
