import { callGemini } from "./client"

// Of the models tried, only this one mapped a modern place to its biblical
// names ("Portugal" -> Társis, Hispânia); the flash-lite models returned
// nothing for it. Thinking is off: it took each call from ~2s to 3-10s and
// the answers did not need it.
export const EXPANSION_MODEL = "gemini-3.8-flash"
const MAX_EXPANSIONS = 4
// Same bound as a typed search, so an odd answer cannot inflate the
// embedding request.
const MAX_EXPANSION_LENGTH = 200
// The search waits for this call, so a slow one is abandoned and the query is
// searched as typed. Calls mostly take ~2s but a few in a hundred passed 4s,
// which dropped those searches to their weaker as-typed results. A single
// attempt for the same reason.
const EXPANSION_TIMEOUT_MS = 8000

const prompt = (
  query: string,
) => `Um leitor pesquisa por significado numa Bíblia católica em português (tradução dos Capuchinhos). Escreve até ${MAX_EXPANSIONS} pesquisas alternativas curtas que encontrem os versículos que respondem à pesquisa dele, com as palavras que o próprio texto bíblico usa: nomes de pessoas e lugares, episódios e expressões típicas da Bíblia. Cada uma tem de apontar, sozinha, para o mesmo assunto da pesquisa: evita palavras ou expressões genéricas que a Bíblia também usa para muitas outras coisas.

Se a pesquisa nomeia um lugar, povo ou realidade moderna que a Bíblia não nomeia, usa os nomes bíblicos que lhe correspondem; por exemplo, para "Iraque": ["Babilónia", "Assíria", "Nínive", "Caldeia"], e para "Turquia": ["Ásia", "Galácia", "Capadócia", "Éfeso"]. Não acrescentes temas só vagamente associados. Se a pesquisa não tiver equivalente nenhum na Bíblia (por exemplo "telemóvel"), devolve uma lista vazia.

Pesquisa: ${query}`

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

/**
 * Rewrites a search in the Bible's own words: the names, places, episodes and
 * phrases its verses use. Embeddings alone cannot connect "Portugal" to
 * Tarshish or "ansiedade" to "não vos inquieteis"; this supplies that
 * knowledge, and the search embeds each phrasing alongside the query.
 *
 * Returns [] when the query has no biblical counterpart, and null when the
 * call fails or times out: the search then carries on with the query as typed,
 * but its result is not worth keeping.
 */
export const expandQuery = async (query: string): Promise<string[] | null> => {
  try {
    const response = await callGemini<GenerateContentResponse>(
      `${EXPANSION_MODEL}:generateContent`,
      {
        contents: [{ parts: [{ text: prompt(query) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: { type: "ARRAY", items: { type: "STRING" } },
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      { timeoutMs: EXPANSION_TIMEOUT_MS, maxAttempts: 1 },
    )

    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
    const parsed: unknown = JSON.parse(text || "[]")
    if (!Array.isArray(parsed)) return []

    // The query itself is always searched, so repeating it adds nothing.
    const seen = new Set([query.trim().toLowerCase()])
    const expansions: string[] = []
    for (const item of parsed) {
      if (typeof item !== "string") continue
      const expansion = item.trim().slice(0, MAX_EXPANSION_LENGTH)
      const key = expansion.toLowerCase()
      if (expansion && !seen.has(key)) {
        seen.add(key)
        expansions.push(expansion)
      }
    }
    return expansions.slice(0, MAX_EXPANSIONS)
  } catch (error) {
    console.error("Query expansion failed; searching as typed:", error)
    return null
  }
}
