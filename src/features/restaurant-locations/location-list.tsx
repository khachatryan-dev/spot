import { ChevronRight, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { RestaurantLocation } from "@/server/db/schema";

/** Locations with links to their settings. */
export function LocationList({
  restaurantId,
  locations,
}: {
  restaurantId: string;
  locations: Pick<RestaurantLocation, "id" | "name" | "addressLine" | "city" | "status">[];
}) {
  const t = useTranslations("Locations");
  if (locations.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {locations.map((location) => (
        <li key={location.id}>
          <Link
            href={`/dashboard/r/${restaurantId}/locations/${location.id}`}
            className="flex items-center gap-3 p-4 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
          >
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-1 flex-col">
              <span className="font-medium">{location.name}</span>
              <span className="text-sm text-muted-foreground">
                {location.addressLine}, {location.city}
              </span>
            </div>
            {location.status === "inactive" && <Badge variant="outline">{t("inactive")}</Badge>}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
