import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express"
import { remindersRateLimiter } from "../middleware/rateLimiter"
import {
  deleteReminder,
  isValidEndpoint,
  parseReminder,
  saveReminder,
  type VapidConfig,
} from "../services/reminders/reminders"
import type { RedisClient } from "../util/redisClient"

export type RemindersSetup = {
  vapid: VapidConfig
  getClient: () => Promise<RedisClient>
}

// A subscription body is well under 1 kB; the bound keeps a client from making
// the parser buffer megabytes.
const parseJson = express.json({ limit: "4kb" })

// The parser's own errors would reach the final handler as 500s.
const jsonBody = (req: Request, res: Response, next: NextFunction) =>
  parseJson(req, res, (error?: { status?: number }) => {
    if (!error) return next()
    if (error.status === 413) {
      return res.status(413).json({ error: "Request body too large" })
    }
    res.status(400).json({ error: "Invalid JSON body" })
  })

// Registered ahead of the import gate: reminders keep their own database and
// have nothing to wait for. Without VAPID keys every route answers 503.
export const setReminderEndpoints = (
  app: express.Express,
  setup: RemindersSetup | undefined,
) => {
  app.get("/v1/mais365/reminders/key", (_req, res) => {
    if (!setup) return res.status(503).json({ error: "Reminders unavailable" })
    res.json({ publicKey: setup.vapid.publicKey })
  })

  app.put(
    "/v1/mais365/reminders",
    remindersRateLimiter,
    jsonBody,
    makeSaveController(setup),
  )
  app.delete(
    "/v1/mais365/reminders",
    remindersRateLimiter,
    jsonBody,
    makeDeleteController(setup),
  )
}

export const makeSaveController =
  (setup: RemindersSetup | undefined) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (!setup) return res.status(503).json({ error: "Reminders unavailable" })
    const reminder = parseReminder(req.body)
    if (typeof reminder === "string") {
      return res.status(400).json({ error: reminder })
    }
    try {
      if (!(await saveReminder(await setup.getClient(), reminder))) {
        return res.status(507).json({ error: "Too many reminders" })
      }
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  }

export const makeDeleteController =
  (setup: RemindersSetup | undefined) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (!setup) return res.status(503).json({ error: "Reminders unavailable" })
    const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint
    if (!isValidEndpoint(endpoint)) {
      return res.status(400).json({ error: "Invalid endpoint" })
    }
    try {
      await deleteReminder(await setup.getClient(), endpoint)
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  }
