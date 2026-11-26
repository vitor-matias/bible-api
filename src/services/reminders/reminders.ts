import { createHash } from "node:crypto"
import webPush from "web-push"
import { mapWithConcurrency } from "../../util/concurrency"
import type { RedisClient } from "../../util/redisClient"

// Web Push reminders for the +365 plan: the app subscribes with a daily time,
// and the API sends one notification a day while that day is still unread.

export type Reminder = {
  endpoint: string
  p256dh: string
  auth: string
  time: string
  timeZone: string
  readOn: string | null
  next: { day: number; title: string } | null
}

export type VapidConfig = {
  subject: string
  publicKey: string
  privateKey: string
}

export type Send = (
  subscription: webPush.PushSubscription,
  payload: string,
  options: webPush.RequestOptions,
) => Promise<unknown>

const IDS_KEY = "reminders"
const keyFor = (id: string) => `reminder:${id}`
export const MAX_REMINDERS = 50_000

// Read once at startup (after dotenv), never at import time. web-push checks
// the keys and subject itself; a malformed value disables reminders instead of
// crashing the API.
export const readVapidConfig = (
  env: NodeJS.ProcessEnv,
): VapidConfig | undefined => {
  const subject = env.VAPID_SUBJECT
  const publicKey = env.VAPID_PUBLIC_KEY
  const privateKey = env.VAPID_PRIVATE_KEY
  if (!subject || !publicKey || !privateKey) return undefined
  try {
    webPush.setVapidDetails(subject, publicKey, privateKey)
  } catch (error) {
    console.error(
      `Reminders disabled, the VAPID settings are invalid: ${error}`,
    )
    return undefined
  }
  return { subject, publicKey, privateKey }
}

// A reimport FLUSHDBs the data database, and subscriptions cannot be
// re-imported, so they live in the next logical database along.
export const remindersDbOptions = (dbUrl: string | undefined) => {
  const url = new URL(dbUrl ?? "redis://localhost:6379")
  const dataDb = Number(url.pathname.slice(1) || 0)
  url.pathname = `/${dataDb + 1}`
  return { url: url.toString() }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// The P-256 public key and the auth secret have fixed sizes (RFC 8291);
// anything else could not be encrypted to anyway.
const isKey = (value: unknown, bytes: number) =>
  typeof value === "string" &&
  value.length <= 100 &&
  BASE64URL.test(value) &&
  Buffer.from(value, "base64url").length === bytes

// The browsers' push services. Anything else would let a caller make this
// server POST to a host of their choosing every day.
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"]
const PUSH_HOST_SUFFIXES = [
  ".push.apple.com",
  ".notify.windows.com",
  ".push.services.mozilla.com",
]

export const isValidEndpoint = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const host = url.hostname
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    (PUSH_HOSTS.includes(host) ||
      PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)))
  )
}

// The zone's canonical name, so case variants of one zone ("europe/lisbon")
// share a cached formatter; undefined when Intl does not know it.
const canonicalTimeZone = (value: unknown) => {
  if (typeof value !== "string" || value.length > 64) return undefined
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
      .timeZone
  } catch {
    return undefined
  }
}

// Round-tripped through Date so 2026-02-30 is refused, not rolled over.
const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  DATE.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().startsWith(value)

// Returns the reminder built from the body's validated fields only, or the
// reason it was refused.
export const parseReminder = (body: unknown): Reminder | string => {
  if (!isObject(body)) return "Expected a JSON object"
  const { subscription, time, timeZone, readOn, next } = body
  if (!isObject(subscription) || !isValidEndpoint(subscription.endpoint)) {
    return "Invalid subscription endpoint"
  }
  const keys = subscription.keys
  if (!isObject(keys) || !isKey(keys.p256dh, 65) || !isKey(keys.auth, 16)) {
    return "Invalid subscription keys"
  }
  if (typeof time !== "string" || !TIME.test(time)) return "Invalid time"
  const zone = canonicalTimeZone(timeZone)
  if (!zone) return "Invalid timeZone"
  if (readOn !== null && !isDate(readOn)) return "Invalid readOn"
  if (
    next !== null &&
    !(
      isObject(next) &&
      typeof next.day === "number" &&
      Number.isFinite(next.day) &&
      typeof next.title === "string" &&
      next.title.length <= 200
    )
  ) {
    return "Invalid next"
  }
  return {
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh as string,
    auth: keys.auth as string,
    time,
    timeZone: zone,
    readOn,
    next: next && { day: next.day as number, title: next.title as string },
  }
}

export const reminderId = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex")

// Resolves to false when the reminder is new and the cap is reached. The check
// and the write are not atomic, so concurrent sign-ups can pass the cap by a
// few; it bounds storage, it is not a quota. An update leaves lastSent alone,
// so changing the time or marking a day read keeps it.
export const saveReminder = async (
  client: RedisClient,
  reminder: Reminder,
  now: Date = new Date(),
): Promise<boolean> => {
  const id = reminderId(reminder.endpoint)
  const isNew = !(await client.sIsMember(IDS_KEY, id))
  if (isNew && (await client.sCard(IDS_KEY)) >= MAX_REMINDERS) return false
  // Enabled after today's time: the first reminder comes tomorrow, not the
  // minute after the user switched it on.
  const local = localNow(reminder.timeZone, now)
  const sentToday = isNew && local.time >= reminder.time
  await client
    .multi()
    .hSet(keyFor(id), {
      endpoint: reminder.endpoint,
      p256dh: reminder.p256dh,
      auth: reminder.auth,
      time: reminder.time,
      timeZone: reminder.timeZone,
      readOn: reminder.readOn ?? "",
      next: JSON.stringify(reminder.next),
      ...(sentToday ? { lastSent: local.date } : {}),
    })
    .sAdd(IDS_KEY, id)
    .exec()
  return true
}

export const deleteReminder = async (client: RedisClient, endpoint: string) => {
  const id = reminderId(endpoint)
  await client.multi().del(keyFor(id)).sRem(IDS_KEY, id).exec()
}

// Caches a formatter per time zone: building one is far slower than using it,
// and the zones are a small set Intl accepted at sign-up.
const formatters = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock date ("YYYY-MM-DD") and time ("HH:MM") in a time zone. */
export const localNow = (timeZone: string, now: Date) => {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
    formatters.set(timeZone, format)
  }
  const part = Object.fromEntries(
    format.formatToParts(now).map(({ type, value }) => [type, value]),
  )
  return {
    date: `${part.year}-${part.month}-${part.day}`,
    time: `${part.hour}:${part.minute}`,
  }
}

// Due once the time has passed today, so a minute missed to a restart still
// sends later that day, and a time skipped by a DST change sends right after.
// lastSent stops the repeat of an hour that occurs twice.
export const isDue = (
  reminder: { time: string; readOn: string | null; lastSent?: string },
  local: { date: string; time: string },
) =>
  local.time >= reminder.time &&
  reminder.readOn !== local.date &&
  reminder.lastSent !== local.date

/**
 * In the Angular service worker's format, which shows it and opens the page on
 * tap. Introductions sit between days (6.5) and have no day number to show.
 */
export const reminderPayload = (next: Reminder["next"]) =>
  JSON.stringify({
    notification: {
      title:
        next && Number.isInteger(next.day) ? `+365 · Dia ${next.day}` : "+365",
      body: next ? next.title : "A leitura de hoje espera por si.",
      icon: "/icons/maskable_web_icon_x192.png",
      badge: "/icons/monochrome_icon_x512.png",
      tag: "mais365",
      lang: "pt-PT",
      data: {
        onActionClick: {
          default: { operation: "navigateLastFocusedOrOpen", url: "/mais365" },
        },
      },
    },
  })

// A reminder delivered hours late would arrive after the day has moved on.
const PUSH_TTL_SECONDS = 6 * 60 * 60
const PUSH_TIMEOUT_MS = 10_000
const SEND_CONCURRENCY = 16
// Sends are tried once a day, so this many failures in a row is a week.
export const MAX_FAILED_DAYS = 7

const statusOf = (error: unknown) =>
  isObject(error) && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined

// One pass over every subscription. lastSent is written before the push, so a
// reminder is tried once a day at most: a transient failure loses that day's
// reminder rather than retrying (and possibly repeating it) every minute.
export const sendDueReminders = async (
  client: RedisClient,
  send: Send,
  now: Date = new Date(),
) => {
  const ids = await client.sMembers(IDS_KEY)
  await mapWithConcurrency(ids, SEND_CONCURRENCY, async (id) => {
    const stored: Record<string, string> = await client.hGetAll(keyFor(id))
    if (!stored.endpoint) {
      await client.sRem(IDS_KEY, id)
      return
    }
    const local = localNow(stored.timeZone, now)
    if (
      !isDue(
        {
          time: stored.time,
          readOn: stored.readOn || null,
          lastSent: stored.lastSent,
        },
        local,
      )
    )
      return
    await client.hSet(keyFor(id), "lastSent", local.date)
    try {
      await send(
        {
          endpoint: stored.endpoint,
          keys: { p256dh: stored.p256dh, auth: stored.auth },
        },
        reminderPayload(JSON.parse(stored.next)),
        { TTL: PUSH_TTL_SECONDS, timeout: PUSH_TIMEOUT_MS },
      )
      if (stored.failures && stored.failures !== "0") {
        await client.hSet(keyFor(id), "failures", "0")
      }
    } catch (error) {
      const status = statusOf(error)
      // The push service says the subscription is gone for good, or it has
      // failed every day for a week (a dead host, keys that cannot encrypt).
      if (
        status === 404 ||
        status === 410 ||
        (await client.hIncrBy(keyFor(id), "failures", 1)) >= MAX_FAILED_DAYS
      ) {
        await client.multi().del(keyFor(id)).sRem(IDS_KEY, id).exec()
        return
      }
      // The id, never the endpoint: the URL identifies the device.
      console.warn(
        `Reminder ${id.slice(0, 8)} failed: ${status ?? (error as Error)?.message ?? error}`,
      )
    }
  })
}

const TICK_MS = 60_000

// Started from index.ts only, so tests never leave a timer running.
export const startReminderScheduler = (
  getClient: () => Promise<RedisClient>,
  send: Send = webPush.sendNotification,
) => {
  // A slow pass (thousands of pushes, a stalled push service) must not overlap
  // the next one and send twice.
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await sendDueReminders(await getClient(), send)
    } catch (error) {
      console.error(`Reminder pass failed: ${error}`)
    } finally {
      running = false
    }
  }
  setInterval(tick, TICK_MS).unref()
}
