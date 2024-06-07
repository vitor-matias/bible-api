export const getBookName = (book: USFMBook): string | undefined => {
    return book.headers.find(header =>
         header.tag === 'toc1'
    )?.content 
  }