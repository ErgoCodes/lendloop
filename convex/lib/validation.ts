import { ConvexError } from "convex/values";

export function invalid(message: string): never {
  throw new ConvexError({ code: "INVALID_ARGUMENT", message });
}

/** Trims and enforces length limits on user-provided text. */
export function cleanText(
  value: string,
  field: string,
  opts: { max: number; required?: boolean },
): string {
  const trimmed = value.trim();
  if (opts.required !== false && trimmed.length === 0) invalid(`${field} is required.`);
  if (trimmed.length > opts.max) invalid(`${field} must be at most ${opts.max} characters.`);
  return trimmed;
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) invalid(`Invalid ${field}.`);
  return value as T;
}
