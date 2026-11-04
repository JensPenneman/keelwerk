/** The active tracks of an entity's shape and their versions; events record its id (section 15.1.9). */
export interface ShapeRef {
  readonly id: string;
  readonly tracks: Readonly<Record<string, number>>;
}
