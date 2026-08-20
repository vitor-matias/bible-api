import type { createClient } from "redis"
import { INTRO_LIST_KEY, introKey } from "../usfmImportService/storeIntro"

export const getIntro = async (
  client: ReturnType<typeof createClient>,
  slug: string,
): Promise<BookIntro | null> =>
  (await client.json.get(introKey(slug))) as BookIntro | null

// Listing omits the introduction bodies, which are large; callers fetch a
// single intro by slug to get its content.
export const listIntros = async (
  client: ReturnType<typeof createClient>,
): Promise<IntroSummary[]> => {
  const slugs = await client.lRange(INTRO_LIST_KEY, 0, -1)

  if (slugs.length === 0) return []

  const docs = await client.json.mGet(slugs.map(introKey), "$")
  const intros: IntroSummary[] = []

  for (const doc of docs) {
    const intro = (doc as unknown as BookIntro[] | null)?.[0]
    if (intro) {
      intros.push({ slug: intro.slug, name: intro.name })
    }
  }

  return intros
}
