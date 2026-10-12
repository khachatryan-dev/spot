import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** 404 for notFound() anywhere in the app and for unknown URLs ([...rest]). */
export default async function NotFound() {
  const t = await getTranslations("Status");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <SearchX className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("notFoundDescription")}</p>
      <Button render={<Link href="/" />} variant="outline" className="mt-2">
        {t("home")}
      </Button>
    </main>
  );
}
