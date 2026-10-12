import { describe, expect, it } from "vitest";

import { formatWhen, renderEmail } from "./templates";

describe("renderEmail", () => {
  const values = {
    name: "Anna",
    restaurant: "Ararat",
    when: "Friday at 19:00",
    party: "2 guests",
    address: "1 Abovyan St",
  };

  it("renders subject, text and HTML in the reader's language", () => {
    const en = renderEmail("reservation_confirmed", "en", values, {
      url: "https://spot.am/reservations",
    });
    expect(en.subject).toBe("Confirmed: Ararat, Friday at 19:00");
    expect(en.text).toContain("Hello, Anna!");
    expect(en.text).toContain("My reservations: https://spot.am/reservations");
    expect(en.html).toContain('href="https://spot.am/reservations"');
    const hy = renderEmail("reservation_confirmed", "hy", values);
    expect(hy.subject).toBe("Հաստատված է՝ Ararat, Friday at 19:00");
    expect(hy.text).toContain("Բարև, Anna։");
  });

  it("greets without a name, adds the reason, and escapes HTML", () => {
    const email = renderEmail("reservation_declined", "en", {
      ...values,
      name: "",
      restaurant: "<script>alert(1)</script>",
      reason: "Private event & full",
    });
    expect(email.text).toContain("Hello!");
    expect(email.text).toContain("Reason: Private event & full");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&#60;script&#62;");
    expect(email.html).toContain("Private event &#38; full");
  });

  it("formats times in the restaurant's time zone", () => {
    const at = new Date("2030-01-18T15:00:00Z");
    expect(formatWhen(at, "Asia/Yerevan", "en")).toContain("19:00");
    expect(formatWhen(at, "Asia/Yerevan", "hy")).toContain("19:00");
  });
});
