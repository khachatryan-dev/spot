/** Who is writing to us, so the message reaches the right person (§ contact). */
export const CONTACT_TOPICS = ["guest", "restaurant", "partnership", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const CONTACT_STATUSES = ["new", "handled"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const MAX_CONTACT_MESSAGE = 3000;
