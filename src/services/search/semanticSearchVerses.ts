import type { createClient } from "redis"
import { generateEmbedding } from "../../util/generateEmbeddings"
import { getVerseByKey } from "../verse/getVerse"

export const semanticSearchVerses = async (
  client: ReturnType<typeof createClient>,
  search: string,
): Promise<(Verse | null)[]> => {
  const tensor = await generateEmbedding(search)

  const arr = tensor.tolist()[0]
  const floatArray = new Float32Array(arr)
  const float32Buffer = Buffer.from(floatArray.buffer)

  console.warn(`Semantic search for: ${search}`)

  const results = await client.ft.search(
    "idx:verseEmbedding",
    //"*=>[KNN 12 @embedding $query_vector as score]",
    "@embedding:[VECTOR_RANGE 0.25 $query_vector]=>{$YIELD_DISTANCE_AS: score}",
    {
      PARAMS: {
        query_vector: float32Buffer,
      },
      DIALECT: 2,
      SORTBY: "score",
    },
  )

  console.warn(`Found ${results.total} results`)

  return await Promise.all(
    results.documents.map(async (document): Promise<Verse | null> => {
      console.warn(`Found matching verse: ${document.value.key as string}`)
      return await getVerseByKey(client, document.value.key as string)
    }),
  )
}
