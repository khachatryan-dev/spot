import { describe, expect, it } from "vitest";

import { distanceKm, parseLatLng } from "./geo";

describe("distanceKm", () => {
  it("measures real distances", () => {
    const republicSquare = { lat: 40.1777, lng: 44.5126 };
    const cascade = { lat: 40.1913, lng: 44.5152 };
    expect(distanceKm(republicSquare, cascade)).toBeCloseTo(1.53, 1);
    const gyumri = { lat: 40.7894, lng: 43.8475 };
    expect(distanceKm(republicSquare, gyumri)).toBeCloseTo(88, -1);
    expect(distanceKm(cascade, cascade)).toBe(0);
  });
});

describe("parseLatLng", () => {
  it("reads 'lat,lng' and rounds to about 100 m", () => {
    expect(parseLatLng("40.177712,44.512634")).toEqual({ lat: 40.178, lng: 44.513 });
  });

  it("rejects anything else", () => {
    for (const bad of [undefined, "", "40.1", "abc,def", "95,44", "40,200", ["40,44"]]) {
      expect(parseLatLng(bad)).toBeNull();
    }
  });
});
