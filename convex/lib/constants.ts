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
