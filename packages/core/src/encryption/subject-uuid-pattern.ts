/** The text of a data subject: a lower-case UUID, as the subject columns of the key tables hold it. */
export const subjectUuidPattern: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
