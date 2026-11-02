"use client";

import { CATEGORIES } from "@convex/lib/constants";
import { cn } from "@/lib/utils";

export function CategoryFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (category: string | undefined) => void;
}) {
  const options: (string | undefined)[] = [undefined, ...CATEGORIES];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      {options.map((c) => (
        <button
          key={c ?? "all"}
          type="button"
          onClick={() => onChange(c)}
          aria-pressed={value === c}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent",
            value === c && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {c ?? "All"}
        </button>
      ))}
    </div>
  );
}
