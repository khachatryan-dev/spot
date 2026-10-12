import type messages from "../../messages/en.json";
import type { routing } from "./routing";

// Type-checks translation keys and locales across the app.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
