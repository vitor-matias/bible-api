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
// Splitting on runs of non-slug characters drops leading and trailing
// separators without a trimming pass, which would need an unanchored
// quantifier and backtrack super-linearly on long inputs.
const slugify = (value: string): string =>
  normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-")

export const introSlugFromFileName = (fileName: string): string => {
  const base = fileName.replace(/\.usfm$/i, "")
  const withoutPrefix = base
    .replace(/^\d+[_-]*/, "")
    .replace(/^intro[_-]*/i, "")

  // A name with no slug-able characters at all (e.g. only underscores, or a
  // non-Latin script) still needs an addressable, stable key.
  return (
    slugify(withoutPrefix) ||
    slugify(base) ||
    Buffer.from(base, "utf8").toString("hex")
  )
}

// Bounds the disambiguation search; a slug repeating this often means the file
// names are degenerate, not that one pair happens to collide.
const MAX_SLUG_ATTEMPTS = 100

// Two source files can reduce to the same slug ("Intro_A-B.usfm" and
// "Intro_A_B.usfm"). Overwriting would silently lose one introduction, but
// throwing would fail the whole import and leave the API in permanent 503 —
// so the second one is suffixed and the collision is logged loudly.
const availableSlug = async (
  client: ReturnType<typeof createClient>,
  slug: string,
): Promise<string> => {
  if ((await client.lPos(INTRO_LIST_KEY, slug)) === null) return slug

  for (let attempt = 2; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = `${slug}-${attempt}`

    if ((await client.lPos(INTRO_LIST_KEY, candidate)) === null) {
      console.error(
        `Duplicate introduction slug "${slug}" — storing this one as "${candidate}". Rename the source file to get a stable URL.`,
      )
      return candidate
    }
  }

  throw new Error(
    `Introduction slug "${slug}" collides after ${MAX_SLUG_ATTEMPTS} attempts; rename the source files.`,
  )
}

export const storeIntro = async (
  client: ReturnType<typeof createClient>,
  slug: string,
  name: string,
  introduction: IntroElement[],
): Promise<void> => {
  const storedSlug = await availableSlug(client, slug)

  await client.rPush(INTRO_LIST_KEY, storedSlug)

  await client.json.set(introKey(storedSlug), "$", {
    slug: storedSlug,
    name,
    introduction,
  })
}
