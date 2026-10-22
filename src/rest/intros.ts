import type { Request, Response } from "express"
import { getIntro, listIntros } from "../services/intro/getIntro"

// Slugs are generated from file names during import, so anything else cannot
// match a stored key.
const SLUG_PATTERN = /^[a-z0-9-]+$/

export const getIntrosController = async (_req: Request, res: Response) => {
  const { client } = res.locals

  res.json(await listIntros(client))
}

export const getIntroController = async (req: Request, res: Response) => {
  const { client } = res.locals
  const { slug } = req.params

  if (!SLUG_PATTERN.test(slug)) {
    return res.status(404).json({ error: "Introduction not found" })
  }

  const intro = await getIntro(client, slug)

  if (intro) {
    return res.json(intro)
  }

  res.status(404).json({ error: "Introduction not found" })
}
