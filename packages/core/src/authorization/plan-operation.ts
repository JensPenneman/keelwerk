/**
 * What a plan decides about (section 8.2): `read` selects the rows a caller may see, `create`
 * tests the new row, `transition` covers `update`, `archive`, `restore` and custom instance
 * commands: the pre-image selects, the post-image must pass.
 */
export type PlanOperation = 'read' | 'create' | 'transition';
