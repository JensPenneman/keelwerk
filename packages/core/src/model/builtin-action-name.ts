/** The action names every rule may use without the target mounting them (section 8.1). */
export type BuiltinActionName =
  | '*'
  | 'read'
  | 'write'
  | 'get'
  | 'query'
  | 'changes'
  | 'queryChanges'
  | 'watch'
  | 'history'
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'set';
