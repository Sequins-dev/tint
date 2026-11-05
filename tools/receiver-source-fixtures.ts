/** Receivers are references captured before evaluating property keys and arguments. */
export const receiverSourceFixtures = [
  {
    bytes: 112,
    name: "argument-mutation",
    source: `function run(n: number): number {
      let object = { value: 19, add: function(this: { value: number }, n: number): number { return this.value + n; } };
      const replacement = { value: 1, add: object.add };
      return object.add((object = replacement, 23));
    }`,
  },
  {
    bytes: 112,
    name: "key-mutation",
    source: `function run(n: number): number {
      let object = { value: 19, add: function(this: { value: number }, n: number): number { return this.value + n; } };
      const replacement = { value: 1, add: object.add };
      return object[(object = replacement, "add")](23);
    }`,
  },
  {
    bytes: 112,
    name: "borrowed",
    source: `function run(n: number): number {
      const object = { value: 1, add: function(this: { value: number }, n: number): number { return this.value + n; } };
      const replacement = { value: 19, add: object.add };
      return replacement.add(23);
    }`,
  },
  {
    bytes: 192,
    name: "lexical-return",
    source: `function run(n: number): number {
      const object = { value: 19, make: function(this: { value: number }): (n: number) => number { return (n: number): number => this.value + n; } };
      const callback = object.make();
      return callback(23);
    }`,
  },
  {
    bytes: 272,
    name: "lexical-forwarded",
    source: `function run(n: number): number {
      const object = { value: 19, make: function(this: { value: number }): () => (n: number) => number { return (): (n: number) => number => (n: number): number => this.value + n; } };
      const factory = object.make();
      return factory()(23);
    }`,
  },
] as const;
