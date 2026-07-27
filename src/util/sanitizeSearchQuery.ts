import { normalizeText } from "./normalizeText"

/**
 * Normalizes a user-supplied search term and strips every character that
 * is not a letter, digit, or whitespace, so RediSearch query syntax
 * (quotes, field selectors, operators, wildcards) cannot be injected.
 */
export const sanitizeSearchQuery = (text: string): string => {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}
