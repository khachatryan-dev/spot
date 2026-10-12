/**
 * A simple bar chart (no chart library). The bars are for the eye; the same
 * numbers are in a table for screen readers.
 */
export function BarChart({
  title,
  bars,
  valueLabel,
}: {
  title: string;
  bars: { label: string; value: number; display?: string }[];
  valueLabel: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div aria-hidden className="flex h-32 items-end gap-px">
        {bars.map((bar) => (
          <div
            key={bar.label}
            title={`${bar.label}: ${bar.display ?? bar.value}`}
            className="flex-1 rounded-t bg-primary/80"
            style={{ height: `${Math.max(bar.value > 0 ? 4 : 0, (bar.value / max) * 100)}%` }}
          />
        ))}
      </div>
      <div aria-hidden className="flex justify-between text-[10px] text-muted-foreground">
        <span>{bars[0]?.label}</span>
        <span>{bars.at(-1)?.label}</span>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">—</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.label}>
              <th scope="row">{bar.label}</th>
              <td>{bar.display ?? bar.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
