/** Thrown inside a record's steps once the worker stops: the record is left where it is and finished by the next start pass. */
export class ErasureHalted extends Error {
  constructor() {
    super('The erasure worker stopped before the record was finished.');
    this.name = 'ErasureHalted';
  }
}
