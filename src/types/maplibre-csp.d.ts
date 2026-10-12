// MapLibre's CSP build (no blob: workers) has the same API as the main entry.
declare module "maplibre-gl/dist/maplibre-gl-csp" {
  import maplibregl from "maplibre-gl";
  export default maplibregl;
}
