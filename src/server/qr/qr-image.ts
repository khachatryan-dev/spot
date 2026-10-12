import "server-only";

import QRCode from "qrcode";

/**
 * QR code for a URL as an SVG data URI — sharp at any print size, no client
 * JavaScript. Error correction "M" survives smudges and table wear while
 * keeping the code easy to scan.
 */
export async function qrSvgDataUri(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
