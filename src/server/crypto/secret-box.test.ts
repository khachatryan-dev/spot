import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./secret-box";

describe("secret box", () => {
  it("round-trips and never stores the plain text", () => {
    const sealed = encryptSecret("p@ss wörd");
    expect(sealed).not.toContain("p@ss");
    expect(decryptSecret(sealed)).toBe("p@ss wörd");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("returns null for tampered or foreign values", () => {
    const [version, iv, tag, data] = encryptSecret("secret").split(".");
    const flipped = data!.startsWith("A") ? `B${data!.slice(1)}` : `A${data!.slice(1)}`;
    expect(decryptSecret([version, iv, tag, flipped].join("."))).toBeNull();
    expect(decryptSecret("v2.a.b.c")).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
  });
});
