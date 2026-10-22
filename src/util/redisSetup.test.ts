import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createFakeRedis } from "../testing/fakeRedis"
import { verifyEmbeddingIndex } from "./embeddingIndex"
import { assertRedisModules } from "./requireRedisModules"

// A fake whose FT.INFO reports the given states, one per call, then the last.
const withIndexInfo = (...states: Record<string, number>[]) => {
  let call = 0
  const fake = createFakeRedis(
    undefined,
    () => states[Math.min(call++, states.length - 1)],
  )
  return { fake, calls: () => call }
}

const storeVectors = async (
  fake: ReturnType<typeof createFakeRedis>,
  count: number,
) => {
  for (let n = 1; n <= count; n++) {
    fake.hashes.set(`embedding:gen:1:${n}`, { key: `verse:gen:1:${n}` })
  }
  // Not a vector: outside the scanned prefix.
  fake.hashes.set("other:1", {})
}

describe("verifyEmbeddingIndex", () => {
  it("passes once the index holds every stored vector", async () => {
    const { fake, calls } = withIndexInfo(
      { indexing: 1, num_docs: 1, hash_indexing_failures: 0 },
      { indexing: 0, num_docs: 2, hash_indexing_failures: 0 },
    )
    await storeVectors(fake, 2)

    await verifyEmbeddingIndex(fake.client)

    // It waited for the build to finish before counting.
    assert.equal(calls(), 2)
  })

  it("fails when the index skipped a vector or reports failures", async () => {
    for (const info of [
      { indexing: 0, num_docs: 1, hash_indexing_failures: 0 },
      { indexing: 0, num_docs: 2, hash_indexing_failures: 1 },
    ]) {
      const { fake } = withIndexInfo(info)
      await storeVectors(fake, 2)

      await assert.rejects(verifyEmbeddingIndex(fake.client), /holds/)
    }
  })
})

describe("assertRedisModules", () => {
  it("passes when RedisJSON and RediSearch are loaded", async () => {
    const { client } = createFakeRedis(undefined, undefined, () => [
      { name: "ReJSON" },
      { name: "search" },
    ])

    await assertRedisModules(client)
  })

  it("names the modules a plain Redis lacks", async () => {
    const { client } = createFakeRedis(undefined, undefined, () => [
      { name: "search" },
    ])

    await assert.rejects(assertRedisModules(client), /no RedisJSON module/)
  })

  it("carries on when MODULE LIST is disabled", async () => {
    const { client } = createFakeRedis(undefined, undefined, () => {
      throw new Error("unknown command")
    })

    await assertRedisModules(client)
  })
})
