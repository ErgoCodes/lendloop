"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type Me = FunctionReturnType<typeof api.users.me>;

type CurrentUser = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: Me | undefined;
  isAdmin: boolean;
};

const CurrentUserContext = createContext<CurrentUser | null>(null);

/**
 * Syncs the signed-in Clerk user into Convex once (users.store) and shares
 * their profile with the whole app.
 */
export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  // Clerk user id already synced, so switching accounts re-syncs.
  const [storedFor, setStoredFor] = useState<string | null>(null);
  const stored = isAuthenticated && userId != null && storedFor === userId;
  const me = useQuery(api.users.me, stored ? {} : "skip");

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    let cancelled = false;
    storeUser()
      .then(() => {
        if (!cancelled) setStoredFor(userId);
      })
      .catch((err) => console.error("Failed to sync user", err));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId, storeUser]);

  const value: CurrentUser = {
    isLoading: authLoading || (isAuthenticated && (!stored || me === undefined)),
    isAuthenticated,
    user: isAuthenticated ? me : null,
    isAdmin: me?.role === "admin",
  };

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUser {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error("useCurrentUser must be used inside <CurrentUserProvider>");
  return ctx;
}
