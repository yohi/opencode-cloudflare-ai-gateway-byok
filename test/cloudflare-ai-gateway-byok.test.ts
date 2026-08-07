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
  test("builds gateway options with metadata", () => {
    const metadata = { session: "abc" }
    const options = {
      cacheTtl: 60,
      cacheKey: "key",
      skipCache: true,
      collectLog: false,
    }

    const result = gatewayOptions(options, metadata)

    expect(result.metadata).toBe(metadata)
    expect(result.cacheTtl).toBe(60)
    expect(result.cacheKey).toBe("key")
    expect(result.skipCache).toBe(true)
    expect(result.collectLog).toBe(false)
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

  test("sdk callback creates gateway when package is ai-gateway-provider", async () => {
    const restore = withEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_GATEWAY_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CF_AIG_TOKEN: undefined,
    })
    afterEach(restore)

    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const evt: SdkEvent = { package: "ai-gateway-provider", options: baseOptions(), model: modelStub }
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

    const evt: SdkEvent = { package: "ai-gateway-provider", options: { ...baseOptions(), baseURL: "https://example.com" }, model: modelStub }
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

    const evt: SdkEvent = { package: "ai-gateway-provider", options: {}, model: modelStub }
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

  test("createUnified is called with empty object and model IDs pass through", async () => {
    const ctx = createMockPluginContext()
    await Effect.runPromise(Effect.scoped(CloudflareAIGatewayBYOK(ctx as unknown as import("@opencode-ai/plugin/v2/effect").PluginContext)))

    const fakeSdk = (models: unknown) => ({ gatewayModel: models })
    const evt: LanguageEvent = { model: modelStub, sdk: fakeSdk, options: {}, language: undefined }
    const result = ctx.runLanguage(evt)
    if (result) await Effect.runPromise(result)

    expect(unifiedModelCalls).toEqual(["test-model"])
    expect(evt.language).toMatchObject({ gatewayModel: { unifiedModel: "test-model" } })
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
      package: "ai-gateway-provider",
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
      package: "ai-gateway-provider",
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

    const evt: SdkEvent = { package: "ai-gateway-provider", options: { apiKey: "opt-key" }, model: modelStub }
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
