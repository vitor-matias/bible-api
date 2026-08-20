// Route parameters must be plain digit strings. Number.parseInt("1abc") yields
// 1, which would serve chapter 1 for /v1/gen/1abc — a wrong response, and a
// distinct cache entry for every malformed spelling of the same chapter.
export const parseNumericParam = (value: string | undefined): number =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN
