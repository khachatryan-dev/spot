import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalPage } from "@/features/marketing/legal-page";
import { resolveLocale } from "@/i18n/locale";
import { COMPANY } from "@/shared/config/company";

const SECTIONS = [
  "who",
  "collect",
  "use",
  "restaurants",
  "payments",
  "cookies",
  "keep",
  "rights",
  "children",
  "changes",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Privacy");
  return { title: t("title"), description: t("intro") };
}

export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  await resolveLocale(params);
  const t = await getTranslations("Privacy");
  const legal = await getTranslations("Legal");
  const values = { company: COMPANY.legalName, email: COMPANY.privacyEmail };

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
