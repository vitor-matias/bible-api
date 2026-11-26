import assert from "node:assert/strict"
import { createECDH, randomBytes } from "node:crypto"
import { describe, it, mock } from "node:test"
import webPush from "web-push"
import { createFakeRedis } from "../../testing/fakeRedis"
import { validReminderBody } from "../../testing/reminderFixture"
import {
  deleteReminder,
  isDue,
  localNow,
  MAX_REMINDERS,
  parseReminder,
  type Reminder,
  readVapidConfig,
  reminderId,
  reminderPayload,
  remindersDbOptions,
  type Send,
  saveReminder,
  sendDueReminders,
} from "./reminders"

const validBody = validReminderBody
const endpoint = validBody().subscription.endpoint

const reminder = (overrides: Partial<Reminder> = {}) => ({
  ...(parseReminder(validBody()) as Reminder),
  ...overrides,
})

describe("parseReminder", () => {
  it("keeps only the validated fields of a good body", () => {
    const body = { ...validBody(), extra: "dropped" }
    assert.deepEqual(parseReminder(body), {
      endpoint,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      time: "08:30",
      timeZone: "Europe/Lisbon",
      readOn: "2026-11-25",
      next: { day: 121, title: "Ciclo de violência" },
    })
    const empty = { ...validBody(), readOn: null, next: null }
    assert.equal(typeof parseReminder(empty), "object")
    // Introductions have fractional days.
    const intro = { ...validBody(), next: { day: 6.5, title: "Introdução" } }
    assert.equal(typeof parseReminder(intro), "object")
    const lower = { ...validBody(), timeZone: "europe/lisbon" }
    assert.equal((parseReminder(lower) as Reminder).timeZone, "Europe/Lisbon")
  })

  it("accepts only the browsers' push services", () => {
    const withEndpoint = (endpoint: string) => ({
      ...validBody(),
      subscription: { ...validBody().subscription, endpoint },
    })
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://web.push.apple.com/QF3k",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://eu.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      assert.equal(typeof parseReminder(withEndpoint(ok)), "object", ok)
    }
    for (const bad of [
      "https://fcm.googleapis.com.evil.com/send",
      "https://evilfcm.googleapis.com/send",
      "https://push.apple.com.evil.com/x",
      "https://evilpush.apple.com/x",
      "https://notify.windows.com.evil.com/x",
      "https://evil.com/fcm.googleapis.com",
      "https://evil.com/?h=web.push.apple.com",
      "https://fcm.googleapis.com@evil.com/x",
      "https://user@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "http://fcm.googleapis.com/x",
      "https://example.com/push",
    ]) {
      assert.equal(typeof parseReminder(withEndpoint(bad)), "string", bad)
    }
  })

  it("refuses bad bodies", () => {
    const sub = validBody().subscription
    const bad: [string, unknown][] = [
      ["not an object", "x"],
      ["array", []],
      ["http endpoint", { subscription: { ...sub, endpoint: "http://a.b/c" } }],
      ["junk endpoint", { subscription: { ...sub, endpoint: "not a url" } }],
      [
        "long endpoint",
        {
          subscription: {
            ...sub,
            endpoint: `https://fcm.googleapis.com/${"x".repeat(2048)}`,
          },
        },
      ],
      ["no keys", { subscription: { endpoint } }],
      [
        "short p256dh",
        { subscription: { ...sub, keys: { ...sub.keys, p256dh: "AAAA" } } },
      ],
      [
        "non-base64url auth",
        {
          subscription: {
            ...sub,
            keys: { ...sub.keys, auth: "!!!!!!!!!!!!!!!!!!!!!!" },
          },
        },
      ],
      ["time 24:00", { time: "24:00" }],
      ["time 8:30", { time: "8:30" }],
      ["time number", { time: 830 }],
      ["unknown zone", { timeZone: "Europe/Atlantis" }],
      ["long zone", { timeZone: "x".repeat(100) }],
      ["readOn Feb 30", { readOn: "2026-02-30" }],
      ["readOn junk", { readOn: "yesterday" }],
      ["readOn missing", { readOn: undefined }],
      ["next.day NaN-ish", { next: { day: "121", title: "x" } }],
      ["next.day infinite", { next: { day: Infinity, title: "x" } }],
      ["next.title long", { next: { day: 1, title: "x".repeat(201) } }],
      ["next missing", { next: undefined }],
    ]
    for (const [name, patch] of bad) {
      const body =
        typeof patch === "object" && patch && !Array.isArray(patch)
          ? { ...validBody(), ...patch }
          : patch
      assert.equal(typeof parseReminder(body), "string", name)
    }
  })
})

describe("saveReminder / deleteReminder", () => {
  it("upserts by endpoint hash, keeping lastSent, and deletes", async () => {
    const { client, hashes, sets } = createFakeRedis()
    const id = reminderId(endpoint)

    const early = new Date("2026-11-26T00:00:00Z")
    assert.equal(await saveReminder(client, reminder(), early), true)
    assert.equal(hashes.get(`reminder:${id}`)?.lastSent, undefined)
    hashes.set(`reminder:${id}`, {
      ...hashes.get(`reminder:${id}`),
      lastSent: "2026-11-26",
    })
    await saveReminder(client, reminder({ time: "21:00", next: null }))

    assert.deepEqual([...(sets.get("reminders") ?? [])], [id])
    const stored = hashes.get(`reminder:${id}`)
    assert.equal(stored?.time, "21:00")
    assert.equal(stored?.next, "null")
    assert.equal(stored?.lastSent, "2026-11-26")

    await deleteReminder(client, endpoint)
    await deleteReminder(client, "https://fcm.googleapis.com/fcm/send/unknown")
    assert.equal(hashes.has(`reminder:${id}`), false)
    assert.equal(sets.get("reminders")?.size, 0)
  })

  it("counts a subscription created after today's time as sent today", async () => {
    const { client, hashes } = createFakeRedis()
    const key = `reminder:${reminderId(endpoint)}`
    // 09:00 in Lisbon, past the 08:30 reminder.
    const late = new Date("2026-11-26T09:00:00Z")
    await saveReminder(client, reminder({ readOn: null }), late)
    assert.equal(hashes.get(key)?.lastSent, "2026-11-26")

    const calls: unknown[] = []
    const send: Send = async (...args) => {
      calls.push(args)
    }
    await sendDueReminders(client, send, late)
    assert.equal(calls.length, 0)
    await sendDueReminders(client, send, new Date("2026-11-27T08:30:00Z"))
    assert.equal(calls.length, 1)

    // An update past the time leaves the scheduler's lastSent as it is.
    hashes.set(key, { ...hashes.get(key), lastSent: "2026-11-25" })
    await saveReminder(client, reminder({ time: "07:00" }), late)
    assert.equal(hashes.get(key)?.lastSent, "2026-11-25")
  })

  it("refuses new subscriptions at the cap but still updates existing ones", async () => {
    const { client, sets } = createFakeRedis()
    await saveReminder(client, reminder())
    const ids = sets.get("reminders") as Set<string>
    for (let i = 1; i < MAX_REMINDERS; i++) ids.add(`filler${i}`)

    const other = reminder({
      endpoint: "https://fcm.googleapis.com/fcm/send/other",
    })
    assert.equal(await saveReminder(client, other), false)
    assert.equal(await saveReminder(client, reminder({ time: "09:00" })), true)
  })
})

describe("localNow / isDue", () => {
  const at = (iso: string) => new Date(iso)

  it("reads the wall clock in the reminder's zone", () => {
    const now = at("2026-11-26T05:00:00Z")
    assert.deepEqual(localNow("Europe/Lisbon", now), {
      date: "2026-11-26",
      time: "05:00",
    })
    assert.deepEqual(localNow("America/Los_Angeles", now), {
      date: "2026-11-25",
      time: "21:00",
    })
    assert.deepEqual(localNow("Asia/Tokyo", at("2026-11-26T15:30:00Z")), {
      date: "2026-11-27",
      time: "00:30",
    })
  })

  it("is due from the time on, unless read or sent today", () => {
    const local = { date: "2026-11-26", time: "08:30" }
    const base = { time: "08:30", readOn: null }
    assert.equal(isDue(base, local), true)
    assert.equal(isDue(base, { ...local, time: "08:29" }), false)
    // A missed minute (a restart) still sends later that day.
    assert.equal(isDue(base, { ...local, time: "13:07" }), true)
    assert.equal(isDue({ ...base, readOn: "2026-11-26" }, local), false)
    assert.equal(isDue({ ...base, readOn: "2026-11-25" }, local), true)
    assert.equal(isDue({ ...base, lastSent: "2026-11-26" }, local), false)
    assert.equal(isDue({ ...base, lastSent: "2026-11-25" }, local), true)
  })

  it("sends right after a time skipped by the spring-forward change", () => {
    // Lisbon, 28 March 2027: 01:00 jumps to 02:00, so 01:30 never happens.
    const before = localNow("Europe/Lisbon", at("2027-03-28T00:59:00Z"))
    const after = localNow("Europe/Lisbon", at("2027-03-28T01:00:00Z"))
    const r = { time: "01:30", readOn: null }
    assert.equal(after.time, "02:00")
    assert.equal(isDue(r, before), false)
    assert.equal(isDue(r, after), true)
  })
})

describe("reminderPayload", () => {
  it("is an ngsw notification that opens the plan", () => {
    assert.deepEqual(
      JSON.parse(reminderPayload({ day: 121, title: "Ciclo de violência" })),
      {
        notification: {
          title: "+365 · Dia 121",
          body: "Ciclo de violência",
          icon: "/icons/maskable_web_icon_x192.png",
          badge: "/icons/monochrome_icon_x512.png",
          tag: "mais365",
          lang: "pt-PT",
          data: {
            onActionClick: {
              default: {
                operation: "navigateLastFocusedOrOpen",
                url: "/mais365",
              },
            },
          },
        },
      },
    )
    // An introduction sits between days and has no number to show.
    const intro = JSON.parse(
      reminderPayload({ day: 6.5, title: "Introdução aos Patriarcas" }),
    ).notification
    assert.equal(intro.title, "+365")
    assert.equal(intro.body, "Introdução aos Patriarcas")
    const plain = JSON.parse(reminderPayload(null)).notification
    assert.equal(plain.title, "+365")
    assert.equal(plain.body, "A leitura de hoje espera por si.")
  })
})

describe("sendDueReminders", () => {
  const setup = async (overrides: Partial<Reminder> = {}) => {
    const fake = createFakeRedis()
    // Saved before any reminder's time, so creating it does not count as
    // already sent that day.
    await saveReminder(
      fake.client,
      reminder({ readOn: null, ...overrides }),
      new Date("2026-10-24T23:00:00Z"),
    )
    const calls: Parameters<Send>[] = []
    let failWith: unknown
    const send: Send = async (...args) => {
      calls.push(args)
      if (failWith) throw failWith
    }
    return {
      ...fake,
      calls,
      send,
      fail: (error: unknown) => {
        failWith = error
      },
    }
  }
  const key = `reminder:${reminderId(endpoint)}`

  it("sends once a day, from the time on, and not when read", async () => {
    const { client, calls, send } = await setup()

    await sendDueReminders(client, send, new Date("2026-11-26T08:29:00Z"))
    assert.equal(calls.length, 0)
    await sendDueReminders(client, send, new Date("2026-11-26T08:30:00Z"))
    await sendDueReminders(client, send, new Date("2026-11-26T08:31:00Z"))
    assert.equal(calls.length, 1)

    const [subscription, payload, options] = calls[0]
    assert.equal(subscription.endpoint, endpoint)
    assert.equal(JSON.parse(payload).notification.title, "+365 · Dia 121")
    assert.ok(options.TTL && options.timeout)

    await saveReminder(client, reminder({ readOn: "2026-11-27" }))
    await sendDueReminders(client, send, new Date("2026-11-27T09:00:00Z"))
    assert.equal(calls.length, 1)
  })

  it("does not repeat an hour the fall-back change plays twice", async () => {
    const { client, calls, send } = await setup({ time: "01:30" })
    // Lisbon, 25 October 2026: 02:00 goes back to 01:00, so 01:30 happens
    // at 00:30 and again at 01:30 UTC.
    await sendDueReminders(client, send, new Date("2026-10-25T00:30:00Z"))
    await sendDueReminders(client, send, new Date("2026-10-25T01:30:00Z"))
    assert.equal(calls.length, 1)
  })

  for (const statusCode of [404, 410]) {
    it(`removes a subscription the push service answers ${statusCode}`, async () => {
      const { client, send, fail, hashes, sets } = await setup()
      fail(new webPush.WebPushError("gone", statusCode, {}, "", endpoint))
      await sendDueReminders(client, send, new Date("2026-11-26T09:00:00Z"))
      assert.equal(hashes.has(key), false)
      assert.equal(sets.get("reminders")?.size, 0)
    })
  }

  it("keeps the subscription on other failures, logging no endpoint", async () => {
    const { client, send, fail, hashes, calls } = await setup()
    const warn = mock.method(console, "warn", () => {})
    try {
      fail(new webPush.WebPushError("boom", 500, {}, "", endpoint))
      await sendDueReminders(client, send, new Date("2026-11-26T09:00:00Z"))
      await sendDueReminders(client, send, new Date("2026-11-26T09:01:00Z"))
      assert.equal(hashes.get(key)?.lastSent, "2026-11-26")
      // Tried once a day, not every minute.
      assert.equal(calls.length, 1)
      assert.equal(warn.mock.callCount(), 1)
      assert.ok(!String(warn.mock.calls[0].arguments[0]).includes("fcm."))
    } finally {
      warn.mock.restore()
    }
  })

  it("prunes a subscription after a week of failed days, reset by a success", async () => {
    const { client, send, fail, hashes, sets } = await setup()
    const warn = mock.method(console, "warn", () => {})
    const day = (n: number) =>
      new Date(`2026-11-${String(n).padStart(2, "0")}T09:00:00Z`)
    try {
      fail(new Error("encryption failed"))
      for (let n = 1; n <= 6; n++) await sendDueReminders(client, send, day(n))
      assert.equal(hashes.get(key)?.failures, "6")

      fail(undefined)
      await sendDueReminders(client, send, day(7))
      assert.equal(hashes.get(key)?.failures, "0")

      fail(new Error("encryption failed"))
      for (let n = 8; n <= 13; n++) await sendDueReminders(client, send, day(n))
      assert.ok(hashes.has(key))
      await sendDueReminders(client, send, day(14))
      assert.equal(hashes.has(key), false)
      assert.equal(sets.get("reminders")?.size, 0)
    } finally {
      warn.mock.restore()
    }
  })

  it("sends once when two processes run a pass at the same moment", async () => {
    const { client, calls, send } = await setup()
    const now = new Date("2026-11-26T09:00:00Z")
    await Promise.all([
      sendDueReminders(client, send, now),
      sendDueReminders(client, send, now),
    ])
    assert.equal(calls.length, 1)
  })

  it("drops ids whose hash is gone", async () => {
    const { client, send, sets } = await setup()
    sets.get("reminders")?.add("orphan")
    await sendDueReminders(client, send, new Date("2026-11-26T09:00:00Z"))
    assert.deepEqual([...(sets.get("reminders") ?? [])], [reminderId(endpoint)])
  })
})

describe("web-push with the real library", () => {
  it("builds the request a scheduler pass would send", () => {
    // A real browser subscription: a P-256 public key and a 16-byte secret.
    const ecdh = createECDH("prime256v1")
    ecdh.generateKeys()
    const body = validReminderBody()
    body.subscription.keys = {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    }
    const parsed = parseReminder(body) as Reminder
    const keys = webPush.generateVAPIDKeys()
    assert.ok(
      readVapidConfig({
        VAPID_SUBJECT: "mailto:someone@example.com",
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
      }),
    )

    const details = webPush.generateRequestDetails(
      {
        endpoint: parsed.endpoint,
        keys: { p256dh: parsed.p256dh, auth: parsed.auth },
      },
      reminderPayload(parsed.next),
      { TTL: 3600, timeout: 10_000 },
    )

    assert.equal(details.method, "POST")
    assert.equal(details.endpoint, parsed.endpoint)
    assert.match(String(details.headers.Authorization), /^vapid t=/)
    assert.ok(details.body && details.body.length > 0)
  })
})

describe("readVapidConfig / remindersDbOptions", () => {
  it("needs all three settings, and valid ones", () => {
    const keys = webPush.generateVAPIDKeys()
    const env = {
      VAPID_SUBJECT: "mailto:someone@example.com",
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
    }
    assert.equal(readVapidConfig(env)?.publicKey, keys.publicKey)
    assert.equal(readVapidConfig({ ...env, VAPID_SUBJECT: "" }), undefined)
    const error = mock.method(console, "error", () => {})
    try {
      assert.equal(
        readVapidConfig({ ...env, VAPID_SUBJECT: "someone@example.com" }),
        undefined,
      )
      assert.equal(
        readVapidConfig({ ...env, VAPID_PUBLIC_KEY: "short" }),
        undefined,
      )
    } finally {
      error.mock.restore()
    }
  })

  it("keeps reminders out of the database a reimport flushes", () => {
    const url = (dbUrl?: string, index?: string) =>
      remindersDbOptions(dbUrl, index).url
    assert.equal(url(), "redis://localhost:6379/1")
    assert.equal(
      url("redis://:pw@db.internal:6380"),
      "redis://:pw@db.internal:6380/1",
    )
    assert.equal(url("redis://localhost:6379/3"), "redis://localhost:6379/4")
    assert.equal(
      url("redis://localhost:6379/15", "7"),
      "redis://localhost:6379/7",
    )
    assert.equal(
      url("redis://localhost:6379/0", "03"),
      "redis://localhost:6379/3",
    )
  })

  it("refuses a database past the default range or the data's own", () => {
    const names = /DB_URL.*REMINDERS_DB_INDEX|REMINDERS_DB_INDEX.*DB_URL/
    assert.throws(
      () => remindersDbOptions("redis://localhost:6379/15", undefined),
      names,
    )
    assert.throws(
      () => remindersDbOptions("redis://localhost:6379/2", "2"),
      names,
    )
    assert.throws(
      () => remindersDbOptions(undefined, "-1"),
      /REMINDERS_DB_INDEX/,
    )
    assert.throws(
      () => remindersDbOptions(undefined, "one"),
      /REMINDERS_DB_INDEX/,
    )
  })
})
