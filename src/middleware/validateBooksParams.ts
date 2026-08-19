import { validateQueryParams } from "./validateQueryParams"

// Rejects unrecognized query parameters on /v1/books and bounds withChapters to
// the recognized variants (absent, true, false).
export const validateBooksParams = validateQueryParams(["withChapters"])
