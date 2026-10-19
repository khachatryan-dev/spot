/** Colourful heading band at the top of About, Contact, FAQ and legal pages. */
export function PageHero({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-b from-orange-50 via-amber-50/50 to-background">
      <div
        aria-hidden
        className="absolute -top-20 -right-16 -z-10 size-64 rounded-full bg-orange-200/50 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-24 -left-16 -z-10 size-64 rounded-full bg-emerald-200/40 blur-3xl"
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-4 pt-14 pb-10 text-center motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in motion-safe:slide-in-from-bottom-3">
        {eyebrow && <p className="text-sm font-semibold text-primary">{eyebrow}</p>}
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {subtitle && (
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </section>
  );
}
