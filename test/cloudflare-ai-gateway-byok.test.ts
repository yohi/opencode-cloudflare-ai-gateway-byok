import { describe, expect, test, afterEach, mock } from "bun:test"
import { Effect } from "effect"
import { gatewayConfig, gatewayMetadata, gatewayOptions, stringOption } from "../src/env.js"
import { CloudflareAIGatewayBYOK } from "../src/cloudflare-ai-gateway-byok.js"
import { createMockPluginContext, type LanguageEvent, type SdkEvent } from "./plugin-context.js"

function withEnv(entries: Record<string, string | undefined>): () => void {
  const original: Record<string, string | undefined> = {}
  for (const key of Object.keys(entries)) {
    original[key] = process.env[key]
    if (entries[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = entries[key]
    }
  }
  return () => {
    for (const key of Object.keys(entries)) {
      if (original[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original[key]
      }
    }
  }
}

describe("stringOption", () => {
  test("returns string values", () => {
    expect(stringOption({ key: "value" }, "key")).toBe("value")
  })

  test("returns undefined for non-strings", () => {
    expect(stringOption({ key: 123 }, "key")).toBeUndefined()
    expect(stringOption({ key: undefined }, "key")).toBeUndefined()
    expect(stringOption({}, "key")).toBeUndefined()
  })
})

describe("gatewayConfig", () => {
  test("prefers environment variables over options", () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: "env-account",
      CLOUDFLARE_GATEWAY_ID: "env-gateway",
      CLOUDFLARE_API_TOKEN: "env-token",
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const config = gatewayConfig({
      accountId: "opt-account",
      gatewayId: "opt-gateway",
      apiKey: "opt-key",
    })

    expect(config).toEqual({
      accountId: "env-account",
      gatewayId: "env-gateway",
      apiKey: "env-token",
    })
  })

  test("falls back to CF_AIG_TOKEN when CLOUDFLARE_API_TOKEN is absent", () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_GATEWAY_ID: "gateway",
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: "cf-aig-token",
    })
    afterEach(restore)

    const config = gatewayConfig({ apiKey: "opt-key" })

    expect(config).toEqual({
      accountId: "account",
      gatewayId: "gateway",
      apiKey: "cf-aig-token",
    })
  })

  test("prefers options.gatewayId over options.gateway", () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: "token",
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const config = gatewayConfig({ gatewayId: "gateway-id", gateway: "gateway-legacy" })

    expect(config).toEqual({
      accountId: "account",
      gatewayId: "gateway-id",
      apiKey: "token",
    })
  })

  test("returns undefined when any credential is missing", () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    expect(gatewayConfig({})).toBeUndefined()
    expect(gatewayConfig({ accountId: "account" })).toBeUndefined()
    expect(gatewayConfig({ accountId: "account", gatewayId: "gateway" })).toBeUndefined()
  })
})

describe("gatewayMetadata", () => {
  test("prefers options.metadata over cf-aig-metadata header", () => {
    const metadata = { source: "option" }
    const result = gatewayMetadata({
      metadata,
      headers: { "cf-aig-metadata": '{"source":"header"}' },
    })

    expect(result).toBe(metadata)
  })

  test("parses cf-aig-metadata header JSON", () => {
    const result = gatewayMetadata({
      headers: { "cf-aig-metadata": '{"session":"abc123"}' },
    })

    expect(result).toEqual({ session: "abc123" })
  })

  test("returns undefined for absent or invalid header", () => {
    expect(gatewayMetadata({})).toBeUndefined()
    expect(gatewayMetadata({ headers: {} })).toBeUndefined()
    expect(gatewayMetadata({ headers: { "cf-aig-metadata": "not json" } })).toBeUndefined()
  })

  test("parses differently-cased cf-aig-metadata header", () => {
    expect(
      gatewayMetadata({
        headers: { "CF-AIG-METADATA": '{"variant":"uppercase"}' },
      })
    ).toEqual({ variant: "uppercase" })

    expect(
      gatewayMetadata({
        headers: { "Cf-Aig-Metadata": '{"variant":"mixed"}' },
      })
    ).toEqual({ variant: "mixed" })
  })
})

describe("gatewayOptions", () => {
  test("builds gateway options with metadata and nested fallback", () => {
    const metadata = { session: "abc" }
    const options = {
      settings: {
        cacheTtl: 60,
        cacheKey: "key",
        skipCache: true,
        collectLog: false,
      },
    }

    const result = gatewayOptions(options, metadata)

    expect(result.metadata).toBe(metadata)
    expect(result.cacheTtl).toBe(60)
    expect(result.cacheKey).toBe("key")
    expect(result.skipCache).toBe(true)
    expect(result.collectLog).toBe(false)
  })

  test("prefers top-level options over nested settings", () => {
    const metadata = { session: "abc" }
    const options = {
      cacheTtl: 120,
      cacheKey: "top-key",
      skipCache: false,
      collectLog: true,
      settings: {
        cacheTtl: 60,
        cacheKey: "nested-key",
        skipCache: true,
        collectLog: false,
      },
    }

    const result = gatewayOptions(options, metadata)

    expect(result.cacheTtl).toBe(120)
    expect(result.cacheKey).toBe("top-key")
    expect(result.skipCache).toBe(false)
    expect(result.collectLog).toBe(true)
  })
})

describe("patchGlobalFetch & utils", () => {
  test("handles URL object inputs correctly", async () => {
    delete (globalThis as Record<string, unknown>).__byok_fetch_patched__
    let capturedUrl = ""
    const originalFetch = globalThis.fetch
    const mockFetch = (async (input: Parameters<typeof fetch>[0]) => {
      capturedUrl = input instanceof URL ? input.href : typeof input === "string" ? input : (input as Request).url
      return new Response("ok")
    }) as typeof fetch
    globalThis.fetch = mockFetch

    const { patchGlobalFetch } = await import("../src/utils.js")
    patchGlobalFetch()

    expect(globalThis.fetch).not.toBe(mockFetch)

    const targetUrl = new URL("https://gateway.ai.cloudflare.com/v1/compat/chat/completions")
    await globalThis.fetch(targetUrl)
    expect(capturedUrl).toBe(targetUrl.href)

    globalThis.fetch = originalFetch
    delete (globalThis as Record<string, unknown>).__byok_fetch_patched__
  })

  test("patchGlobalFetch sanitizes body JSON removing max_tokens", async () => {
    delete (globalThis as Record<string, unknown>).__byok_fetch_patched__
    let capturedBody: string | undefined
    const originalFetch = globalThis.fetch
    const mockFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (input instanceof Request) {
        capturedBody = await input.text()
      } else {
        capturedBody = typeof init?.body === "string" ? init.body : undefined
      }
      return new Response("ok")
    }) as typeof fetch
    globalThis.fetch = mockFetch

    const { patchGlobalFetch } = await import("../src/utils.js")
    patchGlobalFetch()

    await globalThis.fetch("https://gateway.ai.cloudflare.com/v1/compat/chat/completions", {
      method: "POST",
      body: JSON.stringify({ max_tokens: 300, model: "gpt-5.6-sol" }),
    })

    expect(capturedBody).toBeDefined()
    const parsed = JSON.parse(capturedBody!)
    expect(parsed.max_tokens).toBeUndefined()
    expect(parsed.max_completion_tokens).toBe(300)

    globalThis.fetch = originalFetch
    delete (globalThis as Record<string, unknown>).__byok_fetch_patched__
  })

  test("wrapModel transforms maxTokens to max_completion_tokens and deletes maxTokens", async () => {
    const { wrapModel } = await import("../src/utils.js")
    let receivedOptions: Record<string, unknown> | undefined
    const mockModel = {
      doGenerate: (opts: Record<string, unknown>) => {
        receivedOptions = opts
      },
    }

    const wrapped = wrapModel(mockModel)
    wrapped.doGenerate({ maxTokens: 100 })

    expect(receivedOptions?.max_completion_tokens).toBe(100)
    expect(receivedOptions?.maxTokens).toBeUndefined()
    expect(receivedOptions?.maxOutputTokens).toBeUndefined()
  })

  test("cleanParams converts reasoningEffort to reasoning_effort = 'none' when tools are present for OpenAI models", async () => {
    const { cleanParams } = await import("../src/utils.js")
    const body: Record<string, unknown> = {
      model: "openai/gpt-4o",
      tools: [{ type: "function" }],
      reasoningEffort: "high",
    }
    cleanParams(body)
    expect(body.reasoningEffort).toBeUndefined()
    expect(body.reasoning_effort).toBe("none")
  })

  test("cleanParams removes reasoning_effort and reasoningEffort for non-OpenAI models (e.g. Gemini)", async () => {
    const { cleanParams } = await import("../src/utils.js")
    const body: Record<string, unknown> = {
      model: "google/gemini-1.5-flash",
      tools: [{ type: "function" }],
      reasoningEffort: "medium",
      reasoning_effort: "high",
    }
    cleanParams(body)
    expect(body.reasoningEffort).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  test("wrapModel sets reasoning_effort = 'none' when tools are present for OpenAI models", async () => {
    const { wrapModel } = await import("../src/utils.js")
    let receivedOptions: Record<string, unknown> | undefined
    const mockModel = {
      doGenerate: (opts: Record<string, unknown>) => {
        receivedOptions = opts
      },
    }

    const wrapped = wrapModel(mockModel)
    wrapped.doGenerate({ model: "openai/gpt-4o", tools: [{ type: "function" }], reasoningEffort: "medium" })

    expect(receivedOptions?.reasoningEffort).toBeUndefined()
    expect(receivedOptions?.reasoning_effort).toBe("none")
  })

  test("cleanParams converts max_tokens to max_completion_tokens, deleting max_tokens and maxOutputTokens", async () => {
    const { cleanParams } = await import("../src/utils.js")
    const body: Record<string, unknown> = {
      max_tokens: 150,
      model: "gpt-4o",
    }
    cleanParams(body)
    expect(body.max_tokens).toBeUndefined()
    expect(body.maxOutputTokens).toBeUndefined()
    expect(body.max_completion_tokens).toBe(150)
  })

  test("cleanParams converts maxTokens / maxOutputTokens to max_completion_tokens and deletes originals", async () => {
    const { cleanParams } = await import("../src/utils.js")
    const body: Record<string, unknown> = {
      maxTokens: 200,
      maxOutputTokens: 200,
    }
    cleanParams(body)
    expect(body.maxTokens).toBeUndefined()
    expect(body.maxOutputTokens).toBeUndefined()
    expect(body.max_completion_tokens).toBe(200)
  })

  test("cleanParams handles nested max_tokens removal recursively", async () => {
    const { cleanParams } = await import("../src/utils.js")
    const body: Record<string, Record<string, unknown>> = {
      options: {
        max_tokens: 500,
      },
    }
    cleanParams(body)
    expect(body.options.max_tokens).toBeUndefined()
    expect(body.options.maxOutputTokens).toBeUndefined()
    expect(body.options.max_completion_tokens).toBe(500)
  })


})


const modelStub = {
  providerID: "cloudflare-ai-gateway-byok",
  api: { id: "test-model" },
} as unknown as import("@opencode-ai/sdk/v2/types").ModelV2Info

describe("CloudflareAIGatewayBYOK", () => {
  let createAiGatewayCalls: Array<unknown> = []
  let unifiedModelCalls: Array<string> = []

  mock.module("ai-gateway-provider", () => ({
    createAiGateway: (opts: unknown) => {
      createAiGatewayCalls.push(opts)
      return (models: unknown) => ({ gatewayModel: models })
    },
  }))

  mock.module("ai-gateway-provider/providers/unified", () => ({
    createUnified: () => (modelId: string) => {
      unifiedModelCalls.push(modelId)
      return { unifiedModel: modelId }
    },
  }))

  mock.module("ai-gateway-provider/providers/google", () => ({
    createGoogleGenerativeAI: () => (modelId: string) => ({ googleModel: modelId }),
  }))

  mock.module("ai-gateway-provider/providers/anthropic", () => ({
    createAnthropic: () => (modelId: string) => ({ anthropicModel: modelId }),
  }))

  mock.module("ai-gateway-provider/providers/openai", () => ({
    createOpenAI: () => ({
      chat: (modelId: string) => ({ openaiModel: modelId }),
    }),
  }))

  afterEach(() => {
    createAiGatewayCalls = []
    unifiedModelCalls = []
  })

  function baseOptions() {
    return {
      accountId: "account",
      gatewayId: "gateway",
      apiKey: "apiKey",
    }
  }

  test("sdk callback creates gateway when package is @yohi/cloudflare-ai-gateway-byok", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = { package: "@yohi/cloudflare-ai-gateway-byok", options: baseOptions(), model: modelStub }
    const result = ctx.runSdk(evt)
    if (result) await Effect.runPromise(result)

    expect(createAiGatewayCalls).toHaveLength(1)
    expect(createAiGatewayCalls[0]).toEqual({
      accountId: "account",
      gateway: "gateway",
      apiKey: "apiKey",
      options: expect.objectContaining({
        metadata: undefined,
        cacheTtl: undefined,
        cacheKey: undefined,
        skipCache: undefined,
        collectLog: undefined,
      }),
    })
  })

  test("sdk callback does nothing for other packages", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = { package: "other-provider", options: baseOptions(), model: modelStub }
    const result = ctx.runSdk(evt)
    if (result) await Effect.runPromise(result)

    expect(createAiGatewayCalls).toHaveLength(0)
  })

  test("sdk callback does nothing when baseURL is set", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = { package: "@yohi/cloudflare-ai-gateway-byok", options: { ...baseOptions(), baseURL: "https://example.com" }, model: modelStub }
    const result = ctx.runSdk(evt)
    if (result) await Effect.runPromise(result)

    expect(createAiGatewayCalls).toHaveLength(0)
  })

  test("sdk callback does nothing when credentials missing", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = { package: "@yohi/cloudflare-ai-gateway-byok", options: {}, model: modelStub }
    const result = ctx.runSdk(evt)
    if (result) await Effect.runPromise(result)

    expect(createAiGatewayCalls).toHaveLength(0)
  })

  test("language hook only handles provider ID cloudflare-ai-gateway-byok", async () => {
    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const fakeSdk = (models: unknown) => ({ gatewayModel: models })
    const otherModel = { providerID: "other-provider", api: { id: "other-model" } } as unknown as import("@opencode-ai/sdk/v2/types").ModelV2Info
    const evt: LanguageEvent = { model: otherModel, sdk: fakeSdk, options: {}, language: undefined }
    const result = ctx.runLanguage(evt)
    if (result) await Effect.runPromise(result)

    expect(unifiedModelCalls).toHaveLength(0)
    expect(evt.language).toBeUndefined()
  })

  test("language hook does nothing when sdk is absent", async () => {
    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: LanguageEvent = { model: modelStub, sdk: undefined, options: {}, language: undefined }
    const result = ctx.runLanguage(evt)
    if (result) await Effect.runPromise(result)

    expect(unifiedModelCalls).toHaveLength(0)
  })

  test("createUnified / resolveModel routes google/gemini models to google provider", async () => {
    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const fakeSdk = {
      languageModel: (modelId: string) => ({ gatewayModel: { modelId } }),
    }
    const googleModel = { providerID: "cloudflare-ai-gateway-byok", api: { id: "google/gemini-1.5-flash" } } as unknown as import("@opencode-ai/sdk/v2/types").ModelV2Info
    const evt: LanguageEvent = { model: googleModel, sdk: fakeSdk, options: {}, language: undefined }
    const result = ctx.runLanguage(evt)
    if (result) await Effect.runPromise(result)

    expect(evt.language as any).toEqual({ gatewayModel: { modelId: "google/gemini-1.5-flash" } })
  })

  test("metadata cache log pass through to createAiGateway", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = {
      package: "@yohi/cloudflare-ai-gateway-byok",
      options: {
        ...baseOptions(),
        cacheTtl: 120,
        cacheKey: "ck",
        skipCache: true,
        collectLog: true,
        metadata: { requestId: "r1" },
      },
      model: modelStub,
    }
    const result = ctx.runSdk(evt)
    if (result) await Effect.runPromise(result)

    expect(createAiGatewayCalls).toHaveLength(1)
    expect(createAiGatewayCalls[0]).toEqual({
      accountId: "account",
      gateway: "gateway",
      apiKey: "apiKey",
      options: expect.objectContaining({
        metadata: { requestId: "r1" },
        cacheTtl: 120,
        cacheKey: "ck",
        skipCache: true,
        collectLog: true,
      }),
    })
  })

  test("environment variables take precedence over options", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: "env-account",
      CLOUDFLARE_GATEWAY_ID: "env-gateway",
      CLOUDFLARE_API_TOKEN: "env-token",
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = {
      package: "@yohi/cloudflare-ai-gateway-byok",
      options: {
        accountId: "opt-account",
        gatewayId: "opt-gateway",
        apiKey: "opt-key",
      },
      model: modelStub,
    }
    const result = ctx.runSdk(evt)
    if (result) await Effect.runPromise(result)

    expect(createAiGatewayCalls).toHaveLength(1)
    expect(createAiGatewayCalls[0]).toEqual({
      accountId: "env-account",
      gateway: "env-gateway",
      apiKey: "env-token",
      options: expect.anything(),
    })
  })

  test("CF_AIG_TOKEN fallback when CLOUDFLARE_API_TOKEN missing", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_GATEWAY_ID: "gateway",
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: "cf-aig-token",
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = { package: "@yohi/cloudflare-ai-gateway-byok", options: { apiKey: "opt-key" }, model: modelStub }
    const result = ctx.runSdk(evt)
    if (result) await Effect.runPromise(result)

    expect(createAiGatewayCalls).toHaveLength(1)
    expect(createAiGatewayCalls[0]).toEqual({
      accountId: "account",
      gateway: "gateway",
      apiKey: "cf-aig-token",
      options: expect.anything(),
    })
  })
})

describe("default plugin export", () => {
  test("has the expected plugin id", async () => {
    const plugin = (await import("../src/index.js")).default
    expect(plugin.id).toBe("@yohi/cloudflare-ai-gateway-byok")
    expect(typeof plugin.effect).toBe("function")
  })

  test("effect registers sdk and language hooks", async () => {
    const plugin = (await import("../src/index.js")).default
    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(plugin.effect(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))
    expect(typeof ctx.runSdk).toBe("function")
    expect(typeof ctx.runLanguage).toBe("function")
  })
})
