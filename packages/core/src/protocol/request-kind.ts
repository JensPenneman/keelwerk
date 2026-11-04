/** Request kinds the interpreter answers (section 7.9.3). */
export type RequestKind =
  | 'load'
  | 'maybe'
  | 'ask'
  | 'all'
  | 'flag'
  | 'id'
  | 'random'
  | 'secret'
  | 'compute'
  | 'perform';
