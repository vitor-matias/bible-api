// One key per verse, holding that verse's vector as raw float32 bytes. The key
// mirrors the verse key, so the verse a vector belongs to is recoverable from
// the key alone.
export const EMBEDDING_KEY_PREFIX = "embedding:"

export const embeddingKey = (
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
  verseNumber: Verse["number"],
): string => `${EMBEDDING_KEY_PREFIX}${bookId}:${chapterNumber}:${verseNumber}`

export const verseKeyFromEmbeddingKey = (key: string): string =>
  `verse:${key.slice(EMBEDDING_KEY_PREFIX.length)}`
