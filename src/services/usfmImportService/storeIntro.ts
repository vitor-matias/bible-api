import type { createClient } from "redis"
import { normalizeText } from "../../util/normalizeText"

export const INTRO_LIST_KEY = "intros"

export const introKey = (slug: string): string => `intro:${slug}`

// USFM peripheral ids carry front matter rather than a book of the Bible. Every
// such file shares one id (FRT), so storing them as books would overwrite each
// other and repeat the same entry in /v1/books. They are kept under their own
// "intro:" namespace, which no search index covers.
const PERIPHERAL_BOOK_IDS = new Set(["frt", "int"])

export const isPeripheralBookId = (bookId: string): boolean =>
  PERIPHERAL_BOOK_IDS.has(bookId.split(/\s+/)[0])

// "00_Intro_Pentateuco.usfm" -> "pentateuco". The id header cannot be used
// because every one of these files declares the same code.
export const introSlugFromFileName = (fileName: string): string => {
  const base = fileName.replace(/\.usfm$/i, "")
  const withoutPrefix = base
    .replace(/^\d+[_-]*/, "")
    .replace(/^intro[_-]*/i, "")

  const slug = normalizeText(withoutPrefix || base)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || normalizeText(base).replace(/[^a-z0-9]+/g, "-")
}

export const storeIntro = async (
  client: ReturnType<typeof createClient>,
  slug: string,
  name: string,
  introduction: IntroElement[],
): Promise<void> => {
  const alreadyListed = await client.lPos(INTRO_LIST_KEY, slug)

  if (alreadyListed === null) {
    await client.rPush(INTRO_LIST_KEY, slug)
  } else {
    // Two source files reduced to the same slug; the second would silently
    // replace the first, which is the failure this namespace exists to avoid.
    console.warn(
      `Duplicate introduction slug "${slug}" — overwriting the previously stored one.`,
    )
  }

  await client.json.set(introKey(slug), "$", { slug, name, introduction })
}
