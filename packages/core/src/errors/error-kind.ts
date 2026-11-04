/** The closed taxonomy of section 10. */
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'not_implemented'
  | 'unavailable'
  | 'unsupported'
  | 'internal';
