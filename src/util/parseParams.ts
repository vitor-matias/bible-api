// Route parameters must be plain digit strings. Number.parseInt("1abc") yields
// 1, which would serve chapter 1 for /v1/gen/1abc — a wrong response, and a
// distinct cache entry for every malformed spelling of the same chapter.
export const parseNumericParam = (value: string | undefined): number => {
  if (value === undefined || !/^\d+$/.test(value)) return Number.NaN

  // Digits alone are not enough: past 2^53 Number() silently rounds, so
  // distinct inputs would collapse onto the same chapter or verse.
  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : Number.NaN
}
