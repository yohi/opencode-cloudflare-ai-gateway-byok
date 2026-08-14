import { afterEach, describe, expect, test } from "bun:test"
import { startMockGateway, stopMockGateway, type MockGateway } from "./mock-gateway.js"

describe("mock gateway", () => {
  let gateway: MockGateway | undefined

  afterEach(async () => {
    if (gateway) {
      await stopMockGateway(gateway)
      gateway = undefined
    }
  })

  test("captures request body and headers", async () => {
    gateway = await startMockGateway()
    const res = await fetch(`${gateway.url}/accounts/test-account/ai/gateway/test-gateway/openai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    })
    expect(res.status).toBe(200)
    expect(gateway.requests).toHaveLength(1)
    expect(gateway.requests[0].provider).toBe("openai")
    expect(gateway.requests[0].headers.authorization).toBe("Bearer test-token")
    expect((gateway.requests[0].body as { model: string }).model).toBe("gpt-4o")
  })

  test("accepts Custom Provider Chat Completions and Responses paths", async () => {
    gateway = await startMockGateway()

    const chatResponse = await fetch(`${gateway.url}/v1/test-account/test-gateway/custom/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "custom-model" }),
    })
    const responsesResponse = await fetch(`${gateway.url}/v1/test-account/test-gateway/custom/v1/responses`, {
      method: "POST",
      body: JSON.stringify({ model: "custom-model" }),
    })

    expect(chatResponse.status).toBe(200)
    expect(responsesResponse.status).toBe(200)
    expect(gateway.requests).toHaveLength(2)
    expect(gateway.requests[0]?.provider).toBe("custom")
    expect(gateway.requests[1]?.provider).toBe("custom")
  })
})
