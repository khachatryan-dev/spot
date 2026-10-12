// Serve MapLibre's web worker from our own origin (CSP "worker-src 'self'"):
// copies it into public/vendor after every install.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl-csp-worker.js"));
mkdirSync("public/vendor", { recursive: true });
copyFileSync(join(dist, "maplibre-gl-csp-worker.js"), "public/vendor/maplibre-gl-csp-worker.js");
