import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalPage } from "@/features/marketing/legal-page";
import { resolveLocale } from "@/i18n/locale";
import { COMPANY } from "@/shared/config/company";

const SECTIONS = [
  "accept",
  "accounts",
  "guests",
  "restaurants",
  "payments",
  "content",
  "conduct",
  "liability",
  "ending",
  "law",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Terms");
  return { title: t("title"), description: t("intro") };
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  await resolveLocale(params);
  const t = await getTranslations("Terms");
  const legal = await getTranslations("Legal");
  const values = { company: COMPANY.legalName, email: COMPANY.email };

  return (
    <LegalPage
      title={t("title")}
      intro={t("intro", values)}
      updatedLabel={(date) => legal("updated", { date })}
      tocLabel={legal("contents")}
      sections={SECTIONS.map((id) => ({
        id,
        title: t(`sections.${id}.title`),
        body: t(`sections.${id}.body`, values),
      }))}
    />
  );
}
