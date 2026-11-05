/** What the check needs of a field: its kind and the element field of a list or set; `FieldDef` and `FieldDescriptor` both fit. */
export interface CredentialHolder {
  readonly kind: string;
  readonly inner: CredentialHolder | null;
}

/** Whether `field` is a credential field (`field.secret()`, `field.verifier()`) or holds one as a list or set member. */
export function holdsCredential(field: CredentialHolder): boolean {
  if (field.kind === 'secret' || field.kind === 'verifier') return true;
  return field.inner !== null && holdsCredential(field.inner);
}
