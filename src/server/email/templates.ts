import "server-only";

import { createTranslator } from "use-intl/core";

import en from "../../../messages/en.json";
import hy from "../../../messages/hy.json";

import type { OutgoingEmail } from "./sender";

/*
 * Email templates (§27) in the recipient's language. Each is a subject, a
 * few paragraphs and an optional button; every value is HTML-escaped.
 */

export const EMAIL_TEMPLATES = [
  "reservation_received",
  "reservation_confirmed",
  "reservation_declined",
  "reservation_cancelled",
  "reservation_reminder",
  "refund_issued",
  "review_verify",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

const MESSAGES = { hy, en } as const;
export type EmailLocale = keyof typeof MESSAGES;
export const emailLocale = (value: string | null | undefined): EmailLocale =>
  value === "en" ? "en" : "hy";

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** "Friday, 18 January at 19:00" in the restaurant's time zone and the reader's language. */
export function formatWhen(at: Date, timeZone: string, locale: EmailLocale) {
  return new Intl.DateTimeFormat(locale === "hy" ? "hy-AM" : "en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(at);
}

export function renderEmail(
  template: EmailTemplate,
  locale: EmailLocale,
  values: Record<string, string | number>,
  action?: { url: string },
): Omit<OutgoingEmail, "to"> {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "Emails" });
  const subject = t(`${template}.subject`, values);
  const name = String(values.name ?? "").trim();
  const paragraphs = [
    name ? t("greeting", { name }) : t("greetingAnonymous"),
    t(`${template}.body`, values),
  ];
  if (values.reason) paragraphs.push(t("reason", { reason: String(values.reason) }));
  const button = action ? { label: t(`${template}.action`), url: action.url } : null;
  const footer = t("footer");

  const text = [
    ...paragraphs,
    ...(button ? [`${button.label}: ${button.url}`] : []),
    "",
    footer,
  ].join("\n\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:auto;padding:24px">
${paragraphs.map((p) => `<p>${escape(p)}</p>`).join("\n")}
${button ? `<p><a href="${escape(button.url)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escape(button.label)}</a></p>` : ""}
<p style="color:#666;font-size:12px">${escape(footer)}</p>
</body></html>`;
  return { subject, text, html };
}
