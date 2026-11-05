"use client";

import { useSyncExternalStore } from "react";
import { localToday } from "@/lib/format";

const subscribe = () => () => {};

/**
 * Local calendar date, or `null` during prerender/hydration.
 * `new Date()` can't run while prerendering with Cache Components, so the server
 * snapshot is `null` and the real date is only read on the client.
 */
export function useToday() {
  return useSyncExternalStore<string | null>(subscribe, localToday, () => null);
}
