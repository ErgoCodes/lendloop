"use client";

import { useEffect, useState } from "react";
import { localToday } from "@/lib/format";

/**
 * Local calendar date, or `null` during prerender/hydration.
 * `new Date()` can't run while prerendering with Cache Components, so it is read after mount.
 */
export function useToday() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localToday()), []);
  return today;
}
