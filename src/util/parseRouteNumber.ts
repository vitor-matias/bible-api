/**
 * Strictly parses a numeric route parameter. Unlike Number.parseInt, this
 * rejects trailing garbage ("12abc"), signs, decimals, and leading zeros
 * ("007"), so each resource has exactly one valid path spelling.
 */
export const parseRouteNumber = (value: string): number | null => {
  return /^(0|[1-9]\d*)$/.test(value) ? Number.parseInt(value, 10) : null
}
