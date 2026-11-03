"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CategoryFilter } from "@/components/category-filter";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PUBLIC_TOOLS_PAGE_SIZE as PAGE_SIZE, type PublicTool } from "@/lib/public-tools";

/**
 * Read-only list for visitors: only name and category come from the backend.
 * `initialTools` is the server-rendered first page, shown until the live
 * subscription answers (only for the unfiltered view it was rendered for).
 */
export function PublicToolList({ initialTools }: { initialTools?: PublicTool[] | null }) {
  const [category, setCategory] = useState<string | undefined>();
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.listPublic,
    { category },
    { initialNumItems: PAGE_SIZE },
  );
  const fallback = category === undefined ? initialTools : null;
  const tools = status === "LoadingFirstPage" && fallback ? fallback : results;
  const loading = status === "LoadingFirstPage" && !fallback;

  return (
    <div className="space-y-4">
      <CategoryFilter value={category} onChange={setCategory} />
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : tools.length === 0 ? (
        <EmptyState title="No tools listed yet">Be the first to lend something.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <li
              key={t._id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <span className="truncate font-medium">{t.name}</span>
              <Badge variant="secondary">{t.category}</Badge>
            </li>
          ))}
        </ul>
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => loadMore(PAGE_SIZE)}
            disabled={status === "LoadingMore"}
          >
            {status === "LoadingMore" ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}
