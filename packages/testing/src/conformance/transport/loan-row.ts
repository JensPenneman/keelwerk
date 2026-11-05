/** The loan rows a subject sees, projected to what both transports must agree on. */
export interface LoanRow {
  readonly borrower: string;
  readonly bookTitle: string;
  readonly state: string;
  readonly dueAt: string;
}
