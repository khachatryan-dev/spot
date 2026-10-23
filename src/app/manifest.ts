import type { MetadataRoute } from "next";

/**
 * Web app manifest: guests can add Spot to their home screen and open it
 * full-screen, straight into the customer app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spot — restaurants, bookings, table ordering",
    short_name: "Spot",
    description: "Find restaurants, book a table, scan the QR code and order from your table.",
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "hy",
    background_color: "#fdfaf6",
    theme_color: "#c2410c",
    categories: ["food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Scan QR", short_name: "Scan", url: "/scan" },
      { name: "Bookings", url: "/reservations" },
    ],
  };
}
