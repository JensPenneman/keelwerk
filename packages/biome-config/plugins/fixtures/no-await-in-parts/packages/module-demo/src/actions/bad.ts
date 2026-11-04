export const parts = {
  arrow: async (): Promise<number> => 1, // expect: plugin/no-await-in-parts
  async method(): Promise<number> { // expect: plugin/no-await-in-parts
    return await Promise.resolve(1); // expect: plugin/no-await-in-parts
  },
  expression: async function inner(): Promise<number> { // expect: plugin/no-await-in-parts
    return 1;
  },
};
