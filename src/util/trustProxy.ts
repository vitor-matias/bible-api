// Express accepts a boolean, a hop count, or a proxy-addr value ("loopback",
// an IP, a CIDR). A numeric value it cannot read as a hop count is dangerous
// rather than inert: Infinity — and even a decimal such as 1.5 — makes every
// hop trusted, so any client can forge X-Forwarded-For and choose the key the
// rate limiters bucket it under. Negative values and 0 silently disable the
// setting instead. Express throws for none of these, so reject them here.
// "true" is rejected too: it trusts every address in X-Forwarded-For, so a
// client whose header reaches the app picks its own req.ip and escapes the
// IP-based rate limiters (express-rate-limit flags it as
// ERR_ERL_PERMISSIVE_TRUST_PROXY). Name the proxy hop count or address instead.
export const parseTrustProxy = (
  rawValue: string,
): boolean | number | string => {
  const value = rawValue.trim()

  if (value === "true") {
    throw new TypeError(
      'TRUST_PROXY="true" trusts every X-Forwarded-For entry and lets clients spoof their IP; use a hop count (e.g. "1") or a trusted proxy IP/CIDR instead',
    )
  }
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
      `TRUST_PROXY must be "false", a non-negative integer hop count, or a proxy-addr value; got "${rawValue}"`,
    )
  }

  return value
}
