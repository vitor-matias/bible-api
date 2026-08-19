// Key holding the highest verse number stored for a chapter. Written during
// import so reads can address verse keys directly instead of scanning for them.
export const chapterVerseMaxKey = (
  bookId: Book["id"],
  chapterNumber: Chapter["number"],
): string => `chapterVerseMax:${bookId}:${chapterNumber}`
