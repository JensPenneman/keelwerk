/** The capabilities an operator can switch off to run the kernel's paths on an adapter that has them. */
export type MaskableCapability =
  | 'rowLocks'
  | 'changeFeed'
  | 'search'
  | 'positionPaging'
  | 'broadcast'
  | 'jobs';
