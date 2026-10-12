"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { LatLng } from "@/shared/domain/geo";

/** OpenFreeMap's free OpenStreetMap style (no key); allowed by our CSP. */
const STYLE = "https://tiles.openfreemap.org/styles/liberty";
/** Yerevan, when there's nothing to show yet. */
const DEFAULT_CENTER: LatLng = { lat: 40.1792, lng: 44.4991 };

export interface MapPin extends LatLng {
  label: string;
  href?: string;
}

/**
 * An interactive map (MapLibre, OpenStreetMap data). Pins link to their page;
 * with `onPick`, clicking the map chooses a point (location settings). The
 * map is extra: everything on it is also listed in the page, so its pins are
 * left out of the keyboard order; MapLibre's own controls stay usable.
 */
export function MapView({
  pins = [],
  you,
  onPick,
  label,
  className,
}: {
  pins?: MapPin[];
  /** The guest's own position ("Near me"). */
  you?: LatLng | null;
  onPick?: (point: LatLng) => void;
  label: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const pick = useRef(onPick);
  const latest = useRef({ pins, you });

  // Keep the click handler current without recreating the map.
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl/dist/maplibre-gl-csp").then(({ default: maplibregl }) => {
      if (cancelled || !container.current) return;
      maplibregl.setWorkerUrl("/vendor/maplibre-gl-csp-worker.js");
      const instance = new maplibregl.Map({
        container: container.current,
        style: STYLE,
        center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
        zoom: 12,
        attributionControl: { compact: true },
      });
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }));
      instance.on("click", (event) =>
        pick.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
      );
      instance.once("load", () => void drawPins(instance, markers.current, latest.current));
      map.current = instance;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Redraw when the pins change (once the map has loaded).
  useEffect(() => {
    latest.current = { pins, you };
    if (map.current?.loaded()) void drawPins(map.current, markers.current, { pins, you });
  }, [pins, you]);

  return (
    <section
      aria-label={label}
      className={className ?? "h-80 w-full overflow-hidden rounded-2xl border"}
    >
      <div ref={container} className="size-full" />
    </section>
  );
}

/** Replace the markers and frame them. */
async function drawPins(
  instance: MapLibreMap,
  markers: Marker[],
  { pins, you }: { pins: MapPin[]; you?: LatLng | null },
) {
  const { default: maplibregl } = await import("maplibre-gl/dist/maplibre-gl-csp");
  for (const marker of markers.splice(0)) marker.remove();
  const points: LatLng[] = [];
  const add = (point: LatLng, className: string, title?: string, href?: string) => {
    const element = document.createElement(href ? "a" : "div");
    element.className = className;
    if (title) element.title = title;
    element.setAttribute("aria-hidden", "true");
    element.tabIndex = -1;
    if (href && element instanceof HTMLAnchorElement) element.href = href;
    markers.push(
      new maplibregl.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(instance),
    );
    points.push(point);
  };
  for (const pin of pins) {
    add(
      pin,
      "block size-4 rounded-full border-2 border-white bg-primary shadow",
      pin.label,
      pin.href,
    );
  }
  if (you) add(you, "size-4 rounded-full border-2 border-white bg-blue-600 shadow");
  if (points.length === 1) {
    instance.jumpTo({ center: [points[0]!.lng, points[0]!.lat], zoom: 15 });
  } else if (points.length > 1) {
    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    instance.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 40, maxZoom: 15, duration: 0 },
    );
  }
}
