export class Holder {
  async create(): Promise<number> { // expect: plugin/no-await-in-parts
    return 1;
  }
}
