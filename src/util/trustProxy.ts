// Express accepts a boolean, a hop count, or a proxy-addr value ("loopback",
// an IP, a CIDR). A numeric value it cannot read as a hop count is dangerous
// rather than inert: Infinity — and even a decimal such as 1.5 — makes every
// hop trusted, so any client can forge X-Forwarded-For and choose the key the
// rate limiters bucket it under. Negative values and 0 silently disable the
// setting instead. Express throws for none of these, so reject them here.
export const parseTrustProxy = (
  rawValue: string,
): boolean | number | string => {
  const value = rawValue.trim()

  if (value === "true") return true
  if (value === "false") return false

  if (/^\d+$/.test(value)) {
    const hops = Number(value)

    if (!Number.isSafeInteger(hops)) {
      throw new TypeError(`TRUST_PROXY hop count is too large: "${rawValue}"`)
    }

    return hops
  }

  if (!Number.isNaN(Number(value))) {
    throw new TypeError(
      `TRUST_PROXY must be "true", "false", a non-negative integer hop count, or a proxy-addr value; got "${rawValue}"`,
    )
  }

  return value
}
