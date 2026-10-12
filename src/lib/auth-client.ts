import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { Auth } from "@/server/auth/auth";

/** Browser auth client: signIn, signUp, signOut, useSession. */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>()],
});
