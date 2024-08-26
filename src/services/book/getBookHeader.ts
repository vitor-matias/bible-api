export const getBookHeader = (
  book: USFMBook,
  headerId: string,
): string | undefined => {
  return book.headers.find((header) => header.tag === headerId)?.content
}
