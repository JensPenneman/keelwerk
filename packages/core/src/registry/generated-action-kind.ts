/** The actions the core generates for an entity when they are switched on (section 16.2.2). */
export type GeneratedActionKind =
  | 'get'
  | 'query'
  | 'changes'
  | 'queryChanges'
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'set'
  | 'watch'
  | 'history';
