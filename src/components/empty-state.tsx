import type { ReactNode } from "react";
import { Leaf } from "lucide-react";

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-mint-400/60 bg-card/60 px-6 py-14 text-center">
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-2xl bg-mint-200/70 text-brand [&>svg]:size-5"
      >
        {icon ?? <Leaf />}
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Small uppercase heading with an optional count pill, used above lists. */
export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-mint-200/70 px-2 py-0.5 text-[11px] text-accent-foreground tabular-nums">
          {count}
        </span>
      )}
    </h2>
  );
}
