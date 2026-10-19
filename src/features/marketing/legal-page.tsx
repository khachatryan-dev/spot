import { getFormatter } from "next-intl/server";

import { COMPANY } from "@/shared/config/company";

import { PageHero } from "./page-hero";

/** Privacy policy and terms: a table of contents, then numbered sections. */
export async function LegalPage({
  title,
  intro,
  updatedLabel,
  tocLabel,
  sections,
}: {
  title: string;
  intro: string;
  updatedLabel: (date: string) => string;
  tocLabel: string;
  sections: { id: string; title: string; body: string }[];
}) {
  const format = await getFormatter();
  const updated = format.dateTime(new Date(`${COMPANY.legalUpdated}T00:00:00Z`), {
    dateStyle: "long",
    timeZone: "UTC",
  });

  return (
    <>
      <PageHero title={title} subtitle={updatedLabel(updated)} />
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-16 lg:grid-cols-[14rem_1fr]">
        <nav aria-label={tocLabel} className="lg:sticky lg:top-6 lg:self-start">
          <ol className="flex flex-col gap-1 rounded-2xl border bg-card p-4 text-sm">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted hover:text-primary"
                >
                  {index + 1}. {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="flex max-w-2xl flex-col gap-8">
          <p className="text-lg text-muted-foreground">{intro}</p>
          {sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="flex scroll-mt-6 flex-col gap-2"
            >
              <h2 id={`${section.id}-title`} className="text-xl font-semibold">
                {index + 1}. {section.title}
              </h2>
              <p className="leading-relaxed whitespace-pre-line text-foreground/90">
                {section.body}
              </p>
            </section>
          ))}
        </article>
      </div>
    </>
  );
}
