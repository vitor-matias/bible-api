export const getBookId = (book: USFMBook): string | undefined => {
  return book.headers.find((header) => header.tag === "id")?.content
}
