export async function drain(items: AsyncIterable<number>): Promise<void> { // expect: plugin/no-await-in-parts
  for await (const item of items) { // expect: plugin/no-await-in-parts
    void item;
  }
}
