"use client";

import { useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { usePaginatedQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { api } from "@convex/_generated/api";
import { CategoryFilter } from "@/components/category-filter";
import { EmptyState } from "@/components/empty-state";
import { SearchInput, useDebounced } from "@/components/search-input";
import { CategoryIcon } from "@/components/category-icon";
import { LoadMore } from "@/components/load-more";
import { Skeleton } from "@/components/ui/skeleton";
import { PUBLIC_TOOLS_PAGE_SIZE as PAGE_SIZE, type PublicTool } from "@/lib/public-tools";

/**
 * Read-only list for visitors: only name and category come from the backend.
 * `initialTools` is the server-rendered first page, shown until the live
 * subscription answers (only for the unfiltered view it was rendered for).
 */
export function PublicToolList({ initialTools }: { initialTools?: PublicTool[] | null }) {
  const [category, setCategory] = useState<string | undefined>();
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim()) || undefined;
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.listPublic,
    { category, search },
    { initialNumItems: PAGE_SIZE },
  );
  const fallback = category === undefined && search === undefined ? initialTools : null;
  const tools = status === "LoadingFirstPage" && fallback ? fallback : results;
  const loading = status === "LoadingFirstPage" && !fallback;

  return (
    <div className="space-y-4">
      <SearchInput value={searchText} onChange={setSearchText} />
      <CategoryFilter value={category} onChange={setCategory} />
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[62px]" />
          ))}
        </div>
      ) : tools.length === 0 ? (
        <EmptyState title={search || category ? "No tools match" : "No tools listed yet"}>
          {search || category
            ? "Try a different search or category."
            : "Be the first to lend something."}
        </EmptyState>
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tools.map((t) => (
            <li key={t._id}>
              <SignInButton mode="modal">
                <button
                  type="button"
                  aria-label={`Sign in to borrow ${t.name}`}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-[border-color,transform] duration-150 ease-out outline-none hover:border-mint-400/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98]"
                >
                  <CategoryIcon category={t.category} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.category}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-brand group-hover:flex group-focus-visible:flex">
                    Borrow <ArrowRight className="size-3.5" aria-hidden />
                  </span>
                </button>
              </SignInButton>
            </li>
          ))}
        </ul>
      )}
      <LoadMore status={status} loadMore={loadMore} pageSize={PAGE_SIZE} />
    </div>
  );
}
