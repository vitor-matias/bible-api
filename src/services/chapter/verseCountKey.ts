// Key holding the highest verse number stored for a chapter. Written during
// import so reads can address verse keys directly instead of scanning for them.
export const chapterVerseMaxKey = (
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): string => `chapterVerseMax:${bookId}:${chapterNumber}`

// Sanity bound on the persisted maximum, not a versification limit: the largest
// real chapter is Psalm 119 at 176 verses. It exists so a corrupt or stale
// marker cannot make getChapter build a multi-million entry key list.
export const MAX_CHAPTER_VERSES = 300
