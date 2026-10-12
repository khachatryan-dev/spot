import "server-only";

import { logger } from "@/server/logger";

/*
 * Email delivery (§27). Until an email service is chosen (Resend, SMTP…),
 * the log sender records that a message would have gone out — the rest of
 * the platform doesn't change when a real sender is plugged in here.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  /** "log" when nothing is actually sent. */
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

const log = logger.child({ module: "email" });

/** Writes the subject and recipient's domain to the log; never the body or full address. */
export const logSender: EmailSender = {
  name: "log",
  async send(email) {
    log.info("Email (not sent: no email service configured)", {
      toDomain: email.to.split("@")[1],
      subject: email.subject,
    });
  },
};

let override: EmailSender | undefined;

export function emailSender(): EmailSender {
  return override ?? logSender;
}

/** Tests capture outgoing mail. */
export function setEmailSenderForTests(sender: EmailSender | undefined) {
  override = sender;
}
