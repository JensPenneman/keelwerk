/** `kw_shapes`: the tracks and versions an event payload was written with (section 15.1.2). */
export function kwShapes(root: string): readonly string[] {
  return [`create table "${root}".kw_shapes (shape_id bytea primary key, tracks jsonb not null)`];
}
