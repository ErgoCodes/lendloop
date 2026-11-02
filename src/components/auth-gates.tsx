"use client";

// convex/react's auth gates aren't marked as client components, so they
// can't be imported directly from Server Components.
export { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
