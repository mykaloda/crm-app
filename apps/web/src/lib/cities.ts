/** Approximate city centres so the profile editor can fill hidden coordinates. */
export const CITY_COORDS: Record<string, [number, number]> = {
  berlin: [52.52, 13.405], potsdam: [52.39, 13.065], hamburg: [53.551, 9.993], munich: [48.137, 11.575], leipzig: [51.34, 12.375],
  vienna: [48.208, 16.373], zurich: [47.377, 8.541], london: [51.507, -0.128], paris: [48.857, 2.352], amsterdam: [52.37, 4.895],
  'new york': [40.713, -74.006], 'san francisco': [37.775, -122.419], moscow: [55.756, 37.617], 'saint petersburg': [59.939, 30.316],
  москва: [55.756, 37.617], 'санкт-петербург': [59.939, 30.316], берлин: [52.52, 13.405],
};

export function coordsFor(city: unknown): [number, number] | undefined {
  return typeof city === 'string' ? CITY_COORDS[city.trim().toLowerCase()] : undefined;
}
