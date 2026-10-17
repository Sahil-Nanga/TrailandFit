/** Morph weights by name -> the influences array of a mesh with this morph dictionary. */
export function influencesFor(dictionary: Record<string, number>, weights: Record<string, number>): number[] {
  const values = new Array<number>(Object.keys(dictionary).length).fill(0);
  for (const [name, weight] of Object.entries(weights)) {
    const index = dictionary[name];
    if (index !== undefined) values[index] = weight;
  }
  return values;
}
