import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Clock, Mail, MapPin, Phone } from "lucide-react";

import { ContactForm } from "@/features/contact/contact-form";
import { PageHero } from "@/features/marketing/page-hero";
import { resolveLocale } from "@/i18n/locale";
import { COMPANY } from "@/shared/config/company";
import { CONTACT_TOPICS, type ContactTopic } from "@/shared/constants/contact";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Contact");
  return { title: t("title"), description: t("subtitle") };
}

export default async function ContactPage({
  params,
  searchParams,
}: PageProps<"/[locale]/contact">) {
  const locale = await resolveLocale(params);
  const { topic } = await searchParams;
  const t = await getTranslations("Contact");
  const initialTopic = CONTACT_TOPICS.includes(topic as ContactTopic)
    ? (topic as ContactTopic)
    : "guest";

  const details = [
    {
      Icon: Mail,
      label: t("details.email"),
      value: COMPANY.email,
      href: `mailto:${COMPANY.email}`,
    },
    {
      Icon: Phone,
      label: t("details.phone"),
      value: COMPANY.phone,
      href: `tel:${COMPANY.phone.replace(/\s/g, "")}`,
    },
    { Icon: MapPin, label: t("details.address"), value: COMPANY.address[locale] },
    {
      Icon: Clock,
      label: t("details.hours"),
      value: t("details.hoursValue", { hours: COMPANY.hours }),
    },
  ];

  return (
    <>
      <PageHero title={t("title")} subtitle={t("subtitle")} />
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 pb-16 lg:grid-cols-[1fr_1.4fr]">
        <section aria-labelledby="details-title" className="flex flex-col gap-4">
          <h2 id="details-title" className="text-xl font-semibold">
            {t("details.title")}
          </h2>
          <ul className="flex flex-col gap-3">
            {details.map(({ Icon, label, value, href }) => (
              <li key={label} className="flex items-center gap-4 rounded-2xl border bg-card p-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-orange-100 text-orange-700">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  {href ? (
                    <a href={href} className="font-medium break-words hover:text-primary">
                      {value}
                    </a>
                  ) : (
                    <span className="font-medium">{value}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section
          aria-labelledby="form-title"
          className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm sm:p-6"
        >
          <h2 id="form-title" className="text-xl font-semibold">
            {t("form.title")}
          </h2>
          <ContactForm initialTopic={initialTopic} />
        </section>
      </div>
    </>
  );
}
