import { resolveLocale } from "@/i18n/locale";

/**
 * Customer table experience (QR → menu → order). Mobile-first, minimal
 * chrome (§35). Pages arrive with the QR flow (Day 33+).
 */
export default async function CustomerLayout({ children, params }: LayoutProps<"/[locale]">) {
  await resolveLocale(params);

  return <div className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</div>;
}
