import { z } from "zod";

import { RESTAURANT_ROLES } from "@/shared/constants/roles";

export const inviteStaffSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("emailInvalid")),
  role: z.enum(RESTAURANT_ROLES),
});

export const changeRoleSchema = z.object({ role: z.enum(RESTAURANT_ROLES) });

export type InviteStaffInput = z.input<typeof inviteStaffSchema>;
