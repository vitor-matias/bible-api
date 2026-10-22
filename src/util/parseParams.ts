// Route parameters must be canonical non-negative integers: plain digits with
// no leading zeros. Number.parseInt("1abc") yields 1, which would serve chapter
// 1 for /v1/gen/1abc, and "01" or "001" would resolve to chapter 1 under a
// different URL — a distinct cache entry for every spelling of the same chapter.
export const parseNumericParam = (value: string | undefined): number => {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/.test(value)) return Number.NaN

  // Digits alone are not enough: past 2^53 Number() silently rounds, so
  // distinct inputs would collapse onto the same chapter or verse.
  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : Number.NaN
}
