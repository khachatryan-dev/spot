"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { RESTAURANT_ROLES, type RestaurantRole } from "@/shared/constants/roles";

export function RoleSelect({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<"select">, "value" | "onChange"> & {
  value: RestaurantRole;
  onChange: (role: RestaurantRole) => void;
}) {
  const t = useTranslations("Onboarding.dashboard.roles");
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RestaurantRole)}
      className={cn(
        "h-8 rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {RESTAURANT_ROLES.map((role) => (
        <option key={role} value={role}>
          {t(role)}
        </option>
      ))}
    </select>
  );
}
