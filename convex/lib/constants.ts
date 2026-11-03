export const CATEGORIES = [
  "Power tools",
  "Hand tools",
  "Garden",
  "Ladders & access",
  "Cleaning",
  "Camping & outdoors",
  "Kitchen",
  "Other",
] as const;

export const CONDITIONS = ["New", "Good", "Fair", "Worn"] as const;

export const LIMITS = {
  toolName: 80,
  description: 1000,
  requestMessage: 500,
  /** Maximum loan length in days. */
  maxLoanDays: 30,
  /** How far in the future a loan can start, in days. */
  maxLeadDays: 180,
} as const;

/**
 * Abuse limits. Every loan request emails the tool owner and every tool is
 * shown to everyone, so both are capped per user.
 */
export const RATE_LIMITS = {
  /** Undecided requests a borrower can have open at once, across all tools. */
  maxPendingRequests: 10,
  /** New loan requests per borrower in a rolling hour. */
  requestsPerHour: 20,
  /** Listed (not deleted) tools per owner. */
  maxActiveTools: 100,
  /** New tools per owner in a rolling hour. */
  toolsPerHour: 20,
  windowMs: 60 * 60 * 1000,
} as const;
