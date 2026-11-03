"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AvailabilityText } from "@/components/availability";
import { BorrowDialog } from "@/components/borrow-dialog";
import { CategoryFilter } from "@/components/category-filter";
import { useCurrentUser } from "@/components/current-user-provider";
import { LoadMore } from "@/components/load-more";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { TrustedBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { withToast } from "@/lib/errors";

const PAGE_SIZE = 24;

export default function ToolsPage() {
  const [category, setCategory] = useState<string | undefined>();
  const { user, isAdmin } = useCurrentUser();
  const {
    results: tools,
    status,
    loadMore,
  } = usePaginatedQuery(api.tools.list, user ? { category } : "skip", {
    initialNumItems: PAGE_SIZE,
  });
  const removeTool = useMutation(api.tools.remove);

  async function adminDelete(toolId: Id<"tools">, name: string) {
    if (!confirm(`Delete "${name}" as an admin? Pending requests will be rejected.`)) return;
    await withToast(() => removeTool({ toolId }), "Tool deleted.");
  }

  return (
    <>
      <PageHeader title="Browse tools" description="Everything neighbours are lending right now." />
      <div className="mb-6">
        <CategoryFilter value={category} onChange={setCategory} />
      </div>

      {status === "LoadingFirstPage" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : tools.length === 0 ? (
        <EmptyState title="No tools in this category">Try another category.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <Card key={t._id} className="gap-4">
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t.category}</Badge>
                  <span>Condition: {t.condition}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                {t.description && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{t.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{t.isMine ? "Your listing" : `Lent by ${t.owner.name}`}</span>
                  {t.owner.trustedLender && <TrustedBadge />}
                </div>
                <AvailabilityText availability={t.availability} />
              </CardContent>
              <CardFooter className="gap-2">
                {!t.isMine && <BorrowDialog toolId={t._id} toolName={t.name} />}
                {isAdmin && !t.isMine && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => adminDelete(t._id, t.name)}
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 /> Delete
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      <div className="mt-6">
        <LoadMore status={status} loadMore={loadMore} pageSize={PAGE_SIZE} />
      </div>
    </>
  );
}
