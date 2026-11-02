import { cacheLife } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { PUBLIC_TOOLS_PAGE_SIZE, type PublicTool } from "@/lib/public-tools";

/**
 * First page of the public board, rendered into the static shell of "/" and
 * refreshed in the background every few minutes. The client then takes
 * over with a live subscription, so this only removes the loading skeleton
 * (and gives crawlers real content). Returns null if Convex is unreachable,
 * in which case the client loads the list as before.
 */
export async function getInitialPublicTools(): Promise<PublicTool[] | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const { page } = await fetchQuery(api.tools.listPublic, {
      paginationOpts: { numItems: PUBLIC_TOOLS_PAGE_SIZE, cursor: null },
    });
    return page;
  } catch (err) {
    console.warn("Could not prerender the public tool list", err);
    return null;
  }
}
