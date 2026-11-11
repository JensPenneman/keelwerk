/** One name a type is about to take in a map of fields, arguments or input fields, with the entity, action or error that asks for it. */
export interface GraphqlMember<T> {
  readonly name: string;
  readonly config: T;
  /** The entity ref, action ref or error code that asked for the type this member belongs to. */
  readonly subject: string;
  /** What the member stands for, for a message: "field 'bookId'", "relation 'loans'", "root field", "get by id". */
  readonly from: string;
}
