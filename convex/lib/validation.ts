import { ConvexError } from "convex/values";

export function invalid(message: string): never {
  throw new ConvexError({ code: "INVALID_ARGUMENT", message });
}

// C0/C1 control characters, DEL and Unicode line/paragraph separators.
// Multiline fields may keep \n and \t.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const CONTROL_CHARS_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

/**
 * Trims, enforces length limits and rejects control characters in
 * user-provided text. Single-line values (names) end up in email subjects,
 * so they must not contain line breaks.
 */
export function cleanText(
  value: string,
  field: string,
  opts: { max: number; required?: boolean; multiline?: boolean },
): string {
  const trimmed = value.replace(/\r\n?/g, "\n").trim();
  if (opts.required !== false && trimmed.length === 0) invalid(`${field} is required.`);
  if (trimmed.length > opts.max) invalid(`${field} must be at most ${opts.max} characters.`);
  const forbidden = opts.multiline ? CONTROL_CHARS_EXCEPT_NEWLINE_TAB : CONTROL_CHARS;
  if (forbidden.test(trimmed)) invalid(`${field} contains invalid characters.`);
  return trimmed;
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) invalid(`Invalid ${field}.`);
  return value as T;
}

export function rateLimited(message: string): never {
  throw new ConvexError({ code: "RATE_LIMITED", message });
}
