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
            "cursor-pointer rounded-full border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-primary/60 hover:text-foreground active:scale-[0.97]",
            "aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:font-medium aria-pressed:text-primary-foreground",
          )}
        >
          {c ?? "All"}
        </button>
      ))}
    </div>
  );
}
