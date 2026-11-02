import { ConvexError } from "convex/values";
import { toast } from "sonner";

/** User-facing message for errors thrown by Convex functions. */
export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as { message?: string } | string;
    return typeof data === "string" ? data : (data.message ?? "Something went wrong.");
  }
  return "Something went wrong. Please try again.";
}

/** Runs a mutation, showing a success or error toast. Returns true on success. */
export async function withToast(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn();
    if (success) toast.success(success);
    return true;
  } catch (err) {
    toast.error(errorMessage(err));
    return false;
  }
}
