import { describe, expect, test } from "bun:test"
import { withMockGateway } from "./setup.ts"

describe("e2e setup", () => {
  test("withMockGateway starts and stops a server", async () => {
    let capturedUrl = ""
    await withMockGateway(async (gateway) => {
      capturedUrl = gateway.url
      const res = await fetch(`${gateway.url}/accounts/a/ai/gateway/g/openai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
    })
    expect(capturedUrl).toContain("http://127.0.0.1:")
  })
})
