import {
  type FeatureExtractionPipeline,
  type Tensor,
  pipeline,
} from "@huggingface/transformers"

let extractor:
  | FeatureExtractionPipeline
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  | ((arg0: string, arg1: { pooling: string; normalize: boolean }) => any)

export const generateEmbedding = async (text: string): Promise<Tensor> => {
  // Create a feature-extraction pipeline
  if (!extractor) {
    extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L12-v2",
      {
        cache_dir: "./.cache",
      },
    )
  }
  const output = await extractor(text, { pooling: "cls", normalize: true })
  return output
}
