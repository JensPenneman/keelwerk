/** Lets an action's output set or clear an HttpOnly cookie; applies to browser requests only (sections 16.2.2 and 16.4.10). */
export interface CookieHint {
  readonly set?: {
    readonly name: string;
    readonly from: string;
    readonly expiresFrom?: string;
  };
  readonly clear?: { readonly name: string };
  readonly omitFromBody?: readonly string[];
}
