/** Sorting by one field. */
export interface Sort<R> {
  readonly field: keyof R & string;
  readonly direction: 'asc' | 'desc';
}
