/**
 * Thrown when code inside a unit (or inside `asOwner`) asks the same adapter for another unit:
 * PGlite has one session, so the inner unit would queue behind the outer one forever.
 */
export class PgliteReentrantUnitError extends Error {
  override readonly name: string = 'PgliteReentrantUnitError';

  constructor() {
    super(
      'a unit was requested from inside a unit of the same PGlite adapter; use Unit.nested, or run the work after the outer unit',
    );
  }
}
