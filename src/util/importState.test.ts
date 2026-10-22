import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isDataLoaded, stateAfterLoad } from "./importState"

const loaded = { verses: 35459, vectors: 35459, skippedVectors: 0 }

describe("stateAfterLoad", () => {
  it("is ready when every chapter embedded and every vector was read", () => {
    assert.equal(stateAfterLoad(0, loaded), "ready")
  })

  it("is degraded when some chapters failed to embed", () => {
    assert.equal(stateAfterLoad(3, loaded), "degraded")
  })

  it("is degraded when there are no vectors at all", () => {
    assert.equal(stateAfterLoad(0, { ...loaded, vectors: 0 }), "degraded")
  })

  it("is degraded when stored vectors were unreadable", () => {
    assert.equal(
      stateAfterLoad(0, { ...loaded, skippedVectors: 2 }),
      "degraded",
    )
  })

  it("is failed when the database holds no verses, marked as imported or not", () => {
    const empty = { verses: 0, vectors: 0, skippedVectors: 0 }

    assert.equal(stateAfterLoad(0, empty), "failed")
    assert.equal(stateAfterLoad(0, { ...empty, vectors: 5 }), "failed")
  })
})

describe("isDataLoaded", () => {
  it("serves once the data is loaded, even if only degraded", () => {
    assert.equal(isDataLoaded("ready"), true)
    assert.equal(isDataLoaded("degraded"), true)
  })

  it("does not serve while loading or after a failure", () => {
    assert.equal(isDataLoaded("loading"), false)
    assert.equal(isDataLoaded("failed"), false)
  })
})
