import {
  CookingPot,
  Drill,
  Hammer,
  HardHat,
  Package,
  SprayCan,
  Sprout,
  Tent,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "Power tools": Drill,
  "Hand tools": Hammer,
  Garden: Sprout,
  "Ladders & access": HardHat,
  Cleaning: SprayCan,
  "Camping & outdoors": Tent,
  Kitchen: CookingPot,
};

/** Rounded mint tile with an icon for a tool category. */
export function CategoryIcon({
  category,
  size = "md",
  className,
}: {
  category: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = ICONS[category] ?? Package;
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-mint-200/70 text-brand",
        size === "sm" ? "size-9 rounded-lg [&>svg]:size-4" : "size-11 rounded-xl [&>svg]:size-5",
        className,
      )}
    >
      <Icon />
    </span>
  );
}
