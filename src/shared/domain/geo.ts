/** A point on the map. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in kilometres (haversine; plenty precise for a city). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "40.18,44.51" → a point, or null if it isn't one. Rounded to ~100 m: we never need more. */
export function parseLatLng(value: unknown): LatLng | null {
  if (typeof value !== "string") return null;
  const [lat, lng] = value.split(",").map(Number);
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng))
    return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { lat: round(lat), lng: round(lng) };
}
