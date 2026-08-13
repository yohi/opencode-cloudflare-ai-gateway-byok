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

const BASIC_FLOW_CHILD = "CLOUDFLARE_AIG_E2E_BASIC_FLOW_CHILD"
const AUTH_FALLBACK_CHILD = "CLOUDFLARE_AIG_E2E_AUTH_FALLBACK_CHILD"
const ENV_RESOLUTION_CHILD = "CLOUDFLARE_AIG_E2E_ENV_RESOLUTION_CHILD"
const PROVIDER_ROUTING_CHILD = "CLOUDFLARE_AIG_E2E_PROVIDER_ROUTING_CHILD"

async function runAuthFallbackTestInChild(testName: string): Promise<boolean> {
  if (process.env[AUTH_FALLBACK_CHILD] === "1") return false

  const child = Bun.spawn(
    [process.execPath, "test", import.meta.path, "-t", testName],
    {
      env: { ...process.env, [AUTH_FALLBACK_CHILD]: "1" },
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  expect(await child.exited).toBe(0)
  return true
}

async function runProviderRoutingTestInChild(testName: string): Promise<boolean> {
  if (process.env[PROVIDER_ROUTING_CHILD] === "1") return false

  const child = Bun.spawn(
    [process.execPath, "test", import.meta.path, "-t", testName],
    {
      env: { ...process.env, [PROVIDER_ROUTING_CHILD]: "1" },
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  expect(await child.exited).toBe(0)
  return true
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
  test("basic flow sends a request to the mock gateway and receives a response", async () => {
    if (process.env[BASIC_FLOW_CHILD] !== "1") {
      const child = Bun.spawn(
        [process.execPath, "test", import.meta.path, "-t", "basic flow"],
        {
          env: { ...process.env, [BASIC_FLOW_CHILD]: "1" },
          stdout: "inherit",
          stderr: "inherit",
        },
      )
      expect(await child.exited).toBe(0)
      return
    }

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
  test("uses CF_AIG_TOKEN when CLOUDFLARE_API_TOKEN is absent", async () => {
    if (await runAuthFallbackTestInChild("uses CF_AIG_TOKEN when CLOUDFLARE_API_TOKEN is absent")) return

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

  test("uses options.apiKey when both env tokens are absent", async () => {
    if (await runAuthFallbackTestInChild("uses options.apiKey when both env tokens are absent")) return

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
  test("resolves {env:...} placeholders in options", async () => {
    if (process.env[ENV_RESOLUTION_CHILD] !== "1") {
      const child = Bun.spawn(
        [process.execPath, "test", import.meta.path, "-t", "env resolution"],
        {
          env: { ...process.env, [ENV_RESOLUTION_CHILD]: "1" },
          stdout: "inherit",
          stderr: "inherit",
        },
      )
      expect(await child.exited).toBe(0)
      return
    }

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
  async function runModel(gateway: MockGateway, modelID: string): Promise<CapturedRequest> {
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

  test("routes openai/gpt-4o to openai provider", async () => {
    if (await runProviderRoutingTestInChild("routes openai/gpt-4o to openai provider")) return

    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "openai/gpt-4o")

      expect(request.provider).toBe("openai")
      expect(request.body).toMatchObject({ model: "gpt-4o" })
    })
  })

  test("routes anthropic/claude-sonnet-4 to anthropic provider", async () => {
    if (await runProviderRoutingTestInChild("routes anthropic/claude-sonnet-4 to anthropic provider")) return

    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "anthropic/claude-sonnet-4")

      expect(request.provider).toBe("anthropic")
      expect(request.body).toMatchObject({ model: "claude-sonnet-4" })
    })
  })

  test("routes google/gemini-1.5-flash to google provider", async () => {
    if (await runProviderRoutingTestInChild("routes google/gemini-1.5-flash to google provider")) return

    await withMockGateway(async (gateway) => {
      const request = await runModel(gateway, "google/gemini-1.5-flash")

      expect(request.provider).toBe("google")
      expect(request.body).toMatchObject({ model: "gemini-1.5-flash" })
    })
  })
})

describe("E2E parameter normalization", () => {
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

      const languageModel = {
        async doGenerate(body: Record<string, unknown>): Promise<void> {
          await fetch(
            "https://gateway.ai.cloudflare.com/accounts/test-account/ai/gateway/test-gateway/openai",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          )
        },
      }
      await languageModel.doGenerate(options)

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

  test("normalizes reasoningEffort to reasoning_effort = none when tools are present", async () => {
    await withMockGateway(async (gateway) => {
      const body = await captureOpenAIRequest(gateway, {
        model: "openai/gpt-4o",
        reasoningEffort: "high",
        tools: [{ type: "function", function: { name: "test" } }],
        messages: [{ role: "user", content: "hi" }],
      })

      expect(body).not.toHaveProperty("reasoningEffort")
      expect(body).toHaveProperty("reasoning_effort", "none")
    })
  })

  test("converts maxTokens to max_completion_tokens", async () => {
    await withMockGateway(async (gateway) => {
      const body = await captureOpenAIRequest(gateway, {
        model: "openai/gpt-4o",
        maxTokens: 250,
        messages: [{ role: "user", content: "hi" }],
      })

      expect(body).not.toHaveProperty("maxTokens")
      expect(body).toHaveProperty("max_completion_tokens", 250)
    })
  })
})
