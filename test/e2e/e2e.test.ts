import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import { CloudflareAIGatewayBYOK } from "../../src/cloudflare-ai-gateway-byok.js"
import { createMockPluginContext, type LanguageEvent, type SdkEvent } from "../plugin-context.js"
import type { CapturedRequest, MockGateway } from "./mock-gateway.js"
import { clearEnv, setE2EEnv, withMockGateway } from "./setup.js"

const modelStub = {
  providerID: "cloudflare-ai-gateway-byok",
  api: { id: "openai/gpt-4o" },
} as unknown as ModelV2Info

const isChildProcess = process.env.CLOUDFLARE_AIG_E2E_CHILD === "1"

async function runInChild(testName: string): Promise<void> {

  const child = Bun.spawn(
    [process.execPath, "test", import.meta.path, "-t", testName],
    {
      env: { ...process.env, CLOUDFLARE_AIG_E2E_CHILD: "1" },
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  expect(await child.exited).toBe(0)
}

async function sendOpenAIRequest(options: Record<string, unknown>): Promise<void> {
  const ctx = createMockPluginContext()
  await Effect.runPromise(
    Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as PluginContext)),
  )

  const sdkEvent: SdkEvent = {
    package: "@yohi/cloudflare-ai-gateway-byok",
    options,
    model: modelStub,
  }
  const sdkResult = ctx.runSdk(sdkEvent)
  if (sdkResult) await Effect.runPromise(sdkResult)
  expect(sdkEvent.sdk).toBeDefined()

  const languageEvent: LanguageEvent = {
    model: modelStub,
    sdk: sdkEvent.sdk,
    options: {},
  }
  const languageResult = ctx.runLanguage(languageEvent)
  if (languageResult) await Effect.runPromise(languageResult)
  const languageModel: LanguageModelV3 | undefined = languageEvent.language
  expect(languageModel).toBeDefined()
  if (languageModel === undefined) return

  await languageModel.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  })
}

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

describe("E2E basic flow", () => {
  test.skipIf(isChildProcess)("basic flow launches child", () => runInChild("basic flow"))

  test.skipIf(!isChildProcess)("basic flow sends a request to the mock gateway and receives a response", async () => {

    const restoreEnv = clearEnv()
    try {
      await withMockGateway(async (gateway) => {
        const restoreE2EEnv = setE2EEnv(gateway, {
          CLOUDFLARE_ACCOUNT_ID: "test-account",
          CLOUDFLARE_GATEWAY_ID: "test-gateway",
          CLOUDFLARE_API_TOKEN: "test-token",
        })

        try {
          const ctx = createMockPluginContext()
          await Effect.runPromise(
            Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as PluginContext)),
          )

          const sdkEvent: SdkEvent = {
            package: "@yohi/cloudflare-ai-gateway-byok",
            options: {
              accountId: "opt-account",
              gatewayId: "opt-gateway",
              apiKey: "opt-key",
            },
            model: modelStub,
          }
          const sdkResult = ctx.runSdk(sdkEvent)
          if (sdkResult) await Effect.runPromise(sdkResult)
          expect(sdkEvent.sdk).toBeDefined()

          const languageEvent: LanguageEvent = {
            model: modelStub,
            sdk: sdkEvent.sdk,
            options: {},
          }
          const languageResult = ctx.runLanguage(languageEvent)
          if (languageResult) await Effect.runPromise(languageResult)
          const languageModel: LanguageModelV3 | undefined = languageEvent.language
          expect(languageModel).toBeDefined()
          if (languageModel === undefined) return

          const response = await languageModel.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          })
          expect(response.content).toContainEqual({
            type: "text",
            text: "Hello from mock",
            providerMetadata: undefined,
          })

          expect(gateway.requests).toHaveLength(1)
          expect(gateway.requests[0]?.accountId).toBe("test-account")
          expect(gateway.requests[0]?.gatewayId).toBe("test-gateway")
          expect(gateway.requests[0]?.provider).toBe("openai")
          expect(gateway.requests[0]?.headers["cf-aig-authorization"]).toBe("Bearer test-token")
          expect(gateway.requests[0]?.body).toMatchObject({ model: "gpt-4o" })
        } finally {
          restoreE2EEnv()
        }
      })
    } finally {
      restoreEnv()
    }
  })
})

describe("E2E auth fallback", () => {
  test.skipIf(isChildProcess)("auth fallback launches child tests", async () => {
    await runInChild("uses CF_AIG_TOKEN when CLOUDFLARE_API_TOKEN is absent")
    await runInChild("uses options.apiKey when both env tokens are absent")
  })

  test.skipIf(!isChildProcess)("uses CF_AIG_TOKEN when CLOUDFLARE_API_TOKEN is absent", async () => {

    const restoreEnv = clearEnv()
    try {
      await withMockGateway(async (gateway) => {
        const restoreE2EEnv = setE2EEnv(gateway, {
          CLOUDFLARE_ACCOUNT_ID: "test-account",
          CLOUDFLARE_GATEWAY_ID: "test-gateway",
          CF_AIG_TOKEN: "cf-aig-token",
        })
        delete process.env.CLOUDFLARE_API_TOKEN

        try {
          await sendOpenAIRequest({ apiKey: "opt-key" })

          expect(gateway.requests).toHaveLength(1)
          expect(gateway.requests[0]?.headers["cf-aig-authorization"]).toBe("Bearer cf-aig-token")
        } finally {
          restoreE2EEnv()
        }
      })
    } finally {
      restoreEnv()
    }
  })

  test.skipIf(!isChildProcess)("uses options.apiKey when both env tokens are absent", async () => {

    const restoreEnv = clearEnv()
    try {
      await withMockGateway(async (gateway) => {
        const restoreE2EEnv = setE2EEnv(gateway, {
          CLOUDFLARE_ACCOUNT_ID: "test-account",
          CLOUDFLARE_GATEWAY_ID: "test-gateway",
        })
        delete process.env.CLOUDFLARE_API_TOKEN
        delete process.env.CF_AIG_TOKEN

        try {
          await sendOpenAIRequest({
            accountId: "opt-account",
            gatewayId: "opt-gateway",
            apiKey: "opt-api-key",
          })

          expect(gateway.requests).toHaveLength(1)
          expect(gateway.requests[0]?.headers["cf-aig-authorization"]).toBe("Bearer opt-api-key")
        } finally {
          restoreE2EEnv()
        }
      })
    } finally {
      restoreEnv()
    }
  })
})

describe("E2E env resolution", () => {
  test.skipIf(isChildProcess)("env resolution launches child", () => runInChild("env resolution"))

  test.skipIf(!isChildProcess)("resolves {env:...} placeholders in options", async () => {

    const restoreEnv = clearEnv()
    try {
      await withMockGateway(async (gateway) => {
        const restoreE2EEnv = setE2EEnv(gateway, {
          E2E_ACCOUNT_ID: "test-account",
          E2E_GATEWAY_ID: "test-gateway",
          E2E_API_TOKEN: "test-token",
        })

        try {
          await sendOpenAIRequest({
            accountId: "{env:E2E_ACCOUNT_ID}",
            gatewayId: "{env:E2E_GATEWAY_ID}",
            apiKey: "{env:E2E_API_TOKEN}",
          })

          expect(gateway.requests).toHaveLength(1)
          expect(gateway.requests[0]?.accountId).toBe("test-account")
          expect(gateway.requests[0]?.gatewayId).toBe("test-gateway")
          expect(gateway.requests[0]?.headers["cf-aig-authorization"]).toBe("Bearer test-token")
        } finally {
          restoreE2EEnv()
        }
      })
    } finally {
      restoreEnv()
    }
  })
})

describe("E2E provider routing", () => {
  test.skipIf(isChildProcess)("provider routing launches child tests", async () => {
    await runInChild("routes openai/gpt-4o to openai provider")
    await runInChild("routes anthropic/claude-sonnet-4 to anthropic provider")
    await runInChild("routes google/gemini-1.5-flash to google provider")
    await runInChild("routes Custom Provider without tools through Chat Completions")
    await runInChild("routes Custom Provider with tools through Responses API")
  })

  async function runModel(
    gateway: MockGateway,
    modelID: string,
    options: Record<string, unknown> = {},
  ): Promise<CapturedRequest> {
    const restoreEnv = clearEnv()
    const restoreE2EEnv = setE2EEnv(gateway, {
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      CLOUDFLARE_GATEWAY_ID: "test-gateway",
      CLOUDFLARE_API_TOKEN: "test-token",
    })

    try {
      const ctx = createMockPluginContext()
      await Effect.runPromise(
        Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as PluginContext)),
      )

      const model = {
        providerID: "cloudflare-ai-gateway-byok",
        api: { id: modelID },
      } as unknown as ModelV2Info
      const sdkEvent: SdkEvent = {
        package: "@yohi/cloudflare-ai-gateway-byok",
        options: {},
        model,
      }
      const sdkResult = ctx.runSdk(sdkEvent)
      if (sdkResult) await Effect.runPromise(sdkResult)

      const languageEvent: LanguageEvent = {
        model,
        sdk: sdkEvent.sdk,
        options: {},
      }
      const languageResult = ctx.runLanguage(languageEvent)
      if (languageResult) await Effect.runPromise(languageResult)
      const languageModel: LanguageModelV3 | undefined = languageEvent.language
      expect(languageModel).toBeDefined()
      if (languageModel === undefined) {
        throw new Error("Expected language model to be defined")
      }

      await languageModel.doGenerate({
        ...options,
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })
      const request = gateway.requests[0]
      expect(request).toBeDefined()
      if (request === undefined) {
        throw new Error("Expected the mock gateway to capture a request")
      }
      return request
    } finally {
      restoreE2EEnv()
      restoreEnv()
    }
  }

  test.skipIf(!isChildProcess)("routes openai/gpt-4o to openai provider", async () => {

    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "openai/gpt-4o")

      expect(request.provider).toBe("openai")
      expect(request.body).toMatchObject({ model: "gpt-4o" })
    })
  })

  test.skipIf(!isChildProcess)("routes anthropic/claude-sonnet-4 to anthropic provider", async () => {

    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "anthropic/claude-sonnet-4")

      expect(request.provider).toBe("anthropic")
      expect(request.body).toMatchObject({ model: "claude-sonnet-4" })
    })
  })

  test.skipIf(!isChildProcess)("routes google/gemini-1.5-flash to google provider", async () => {

    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "google/gemini-1.5-flash")

      expect(request.provider).toBe("google")
      expect(request.body).toMatchObject({ model: "gemini-1.5-flash" })
    })
  })

  test.skipIf(!isChildProcess)("routes Custom Provider without tools through Chat Completions", async () => {
    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "custom/custom-model")

      expect(request.provider).toBe("custom")
      expect(request.path).toBe("/v1/test-account/test-gateway/custom/v1/chat/completions")
      expect(request.body).toMatchObject({ model: "custom-model" })
    })
  })

  test.skipIf(!isChildProcess)("routes Custom Provider with tools through Responses API", async () => {
    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "custom/custom-model", {
        tools: [{ type: "function", name: "test", inputSchema: {} }],
      })

      expect(request.provider).toBe("custom")
      expect(request.path).toBe("/v1/test-account/test-gateway/custom/v1/responses")
      expect(request.body).toMatchObject({
        model: "custom-model",
        tools: [{ type: "function", name: "test" }],
      })
    })
  })
})

describe("E2E parameter normalization", () => {
  test.skipIf(isChildProcess)("parameter normalization launches child tests", async () => {
    await runInChild("normalizes reasoningEffort to reasoning_effort = none when tools are present")
    await runInChild("converts maxTokens to max_completion_tokens")
  })

  type GatewaySdk = {
    languageModel(modelID: string): LanguageModelV3
  }

  function isGatewaySdk(value: unknown): value is GatewaySdk {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      return false
    }
    return "languageModel" in value && typeof value.languageModel === "function"
  }

  async function captureOpenAIRequest(
    gateway: MockGateway,
    options: Record<string, unknown>,
  ): Promise<unknown> {
    const restoreEnv = clearEnv()
    const restoreE2EEnv = setE2EEnv(gateway, {
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      CLOUDFLARE_GATEWAY_ID: "test-gateway",
      CLOUDFLARE_API_TOKEN: "test-token",
    })

    try {
      const ctx = createMockPluginContext()
      await Effect.runPromise(
        Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as PluginContext)),
      )

      const sdkEvent: SdkEvent = {
        package: "@yohi/cloudflare-ai-gateway-byok",
        options: {},
        model: modelStub,
      }
      const sdkResult = ctx.runSdk(sdkEvent)
      if (sdkResult) await Effect.runPromise(sdkResult)
      expect(isGatewaySdk(sdkEvent.sdk)).toBe(true)
      if (!isGatewaySdk(sdkEvent.sdk)) {
        throw new Error("Expected SDK to expose languageModel")
      }

      const languageModel = sdkEvent.sdk.languageModel("openai/gpt-4o")
      await languageModel.doGenerate({
        ...options,
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })

      const request = gateway.requests[0]
      expect(request).toBeDefined()
      if (request === undefined) {
        throw new Error("Expected the mock gateway to capture a request")
      }
      return request.body
    } finally {
      restoreE2EEnv()
      restoreEnv()
    }
  }

  test.skipIf(!isChildProcess)("normalizes reasoningEffort to reasoning_effort = none when tools are present", async () => {

    await withMockGateway(async (gateway) => {
      const body = await captureOpenAIRequest(gateway, {
        model: "openai/gpt-4o",
        reasoningEffort: "high",
        tools: [{ type: "function", name: "test", inputSchema: {} }],
      })

      expect(body).not.toHaveProperty("reasoningEffort")
      expect(body).toHaveProperty("reasoning_effort", "none")
    })
  })

  test.skipIf(!isChildProcess)("converts maxTokens to max_completion_tokens", async () => {

    await withMockGateway(async (gateway) => {
      const body = await captureOpenAIRequest(gateway, {
        model: "openai/gpt-4o",
        maxTokens: 250,
      })

      expect(body).not.toHaveProperty("maxTokens")
      expect(body).toHaveProperty("max_completion_tokens", 250)
    })
  })
})
