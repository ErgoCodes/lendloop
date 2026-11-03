"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { SearchX, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AvailabilityText } from "@/components/availability";
import { BorrowDialog } from "@/components/borrow-dialog";
import { CategoryFilter } from "@/components/category-filter";
import { useCurrentUser } from "@/components/current-user-provider";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { LoadMore } from "@/components/load-more";
import { SearchInput, useDebounced } from "@/components/search-input";
import { TrustedBadge } from "@/components/status-badge";
import { ToolCard } from "@/components/tool-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { withToast } from "@/lib/errors";

const PAGE_SIZE = 24;

export default function ToolsPage() {
  const [category, setCategory] = useState<string | undefined>();
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim()) || undefined;
  const { user, isAdmin } = useCurrentUser();
  const {
    results: tools,
    status,
    loadMore,
  } = usePaginatedQuery(api.tools.list, user ? { category, search } : "skip", {
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
      <div className="mb-8 space-y-3">
        <SearchInput value={searchText} onChange={setSearchText} />
        <CategoryFilter value={category} onChange={setCategory} />
      </div>

      {status === "LoadingFirstPage" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : tools.length === 0 ? (
        <EmptyState title="No tools match" icon={<SearchX />}>
          Try a different search or category.
        </EmptyState>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {tools.map((t) => (
            <ToolCard
              key={t._id}
              name={t.name}
              category={t.category}
              condition={t.condition}
              footer={
                t.isMine ? undefined : (
                  <>
                    <BorrowDialog toolId={t._id} toolName={t.name} />
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-muted-foreground hover:text-destructive"
                        onClick={() => adminDelete(t._id, t.name)}
                        aria-label={`Delete ${t.name}`}
                      >
                        <Trash2 /> Delete
                      </Button>
                    )}
                  </>
                )
              }
            >
              {t.description && (
                <p className="line-clamp-3 text-sm text-muted-foreground">{t.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {t.isMine ? (
                  <span className="font-medium text-brand">Your listing</span>
                ) : (
                  <span>
                    <span className="text-muted-foreground">Lent by</span>{" "}
                    <span className="font-medium">{t.owner.name}</span>
                  </span>
                )}
                {t.owner.trustedLender && <TrustedBadge />}
              </div>
              <AvailabilityText availability={t.availability} />
            </ToolCard>
          ))}
        </div>
      )}
      <div className="mt-8">
        <LoadMore status={status} loadMore={loadMore} pageSize={PAGE_SIZE} />
      </div>
    </>
  );
}
