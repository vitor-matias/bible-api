import type { createClient } from "redis"
import { jsonMGet } from "../../util/jsonMGet"
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

  const docs = await jsonMGet<BookIntro>(client, slugs.map(introKey))
  const intros: IntroSummary[] = []

  for (const intro of docs) {
    if (intro) {
      intros.push({ slug: intro.slug, name: intro.name })
    }
  }

  return intros
}
