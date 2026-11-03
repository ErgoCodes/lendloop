import type { ReactNode } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

/** Shared card layout for a tool: icon + name + category/condition, body, actions. */
export function ToolCard({
  name,
  category,
  condition,
  children,
  footer,
}: {
  name: string;
  category: string;
  condition: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="gap-4 transition-[border-color,box-shadow] duration-200 ease-out hover:border-mint-400/70 hover:shadow-[0_1px_2px_rgb(20_60_30/0.05),0_10px_28px_-12px_rgb(20_60_30/0.18)]">
      <CardHeader className="flex items-start gap-3.5">
        <CategoryIcon category={category} />
        <div className="min-w-0 space-y-1">
          <h3 className="truncate leading-tight font-semibold">{name}</h3>
          <p className="text-sm text-muted-foreground">
            {category} <span aria-hidden>·</span> {condition}
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">{children}</CardContent>
      {footer && <CardFooter className="gap-2 border-t border-border/70 pt-4">{footer}</CardFooter>}
    </Card>
  );
}
