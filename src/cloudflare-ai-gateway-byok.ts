import { Effect } from "effect"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { patchGlobalFetch, wrapModel } from "./utils.js"

export const DEFAULT_BASE_URL = "https://gateway.ai.cloudflare.com/v1/compat"

function resolveBaseURL(): string {
  if (typeof process !== "undefined" && process.env?.CLOUDFLARE_AIG_BASE_URL) {
    return process.env.CLOUDFLARE_AIG_BASE_URL
  }
  return DEFAULT_BASE_URL
}

export const CloudflareAIGatewayBYOK = (ctx: PluginContext) =>
  Effect.gen(function* () {
    patchGlobalFetch()

    if (ctx.catalog?.transform) {
      yield* ctx.catalog.transform(({ provider }) => {
        provider.update("cloudflare-ai-gateway-byok", (p) => {
          if (p.api?.type === "aisdk" && !p.api.url) {
            p.api.url = resolveBaseURL()
          }
        })
      })
    }

    yield* ctx.aisdk.sdk((evt) =>
      Effect.gen(function* () {
        if (evt.package !== "@yohi/cloudflare-ai-gateway-byok") return
        const customBaseURL = evt.options.baseURL
        const effectiveBaseURL = resolveBaseURL()
        evt.options.baseURL = customBaseURL ?? effectiveBaseURL

        if (customBaseURL !== undefined) return

        const config = gatewayConfig(evt.options)
        if (config === undefined) return

        const { accountId, gatewayId, apiKey } = config
        const metadata = gatewayMetadata(evt.options)
        const options = gatewayOptions(evt.options, metadata)

        const { createAiGateway } = yield* Effect.promise(
          () => import("ai-gateway-provider")
        ).pipe(Effect.orDie)

        const { createUnified } = yield* Effect.promise(
          () => import("ai-gateway-provider/providers/unified")
        ).pipe(Effect.orDie)

        const { createGoogleGenerativeAI } = yield* Effect.promise(
          () => import("ai-gateway-provider/providers/google")
        ).pipe(Effect.orDie)

        const { createAnthropic } = yield* Effect.promise(
          () => import("ai-gateway-provider/providers/anthropic")
        ).pipe(Effect.orDie)

        const { createOpenAI } = yield* Effect.promise(
          () => import("ai-gateway-provider/providers/openai")
        ).pipe(Effect.orDie)

        const gateway = createAiGateway({
          accountId,
          gateway: gatewayId,
          apiKey,
          options,
        })

        const unified = createUnified({
          baseURL: resolveBaseURL(),
        })
        const google = createGoogleGenerativeAI()
        const anthropic = createAnthropic()
        const openai = createOpenAI()

        function resolveModel(modelID: string) {
          const lower = modelID.toLowerCase()
          if (lower.startsWith("google/") || lower.startsWith("google-ai-studio/") || lower.includes("gemini")) {
            const cleanID = modelID.replace(/^(google-ai-studio|google)\//i, "")
            return gateway(google(cleanID))
          }
          if (lower.startsWith("anthropic/") || lower.includes("claude")) {
            const cleanID = modelID.replace(/^anthropic\//i, "")
            return gateway(anthropic(cleanID))
          }
          if (lower.startsWith("openai/") || lower.includes("gpt") || lower.startsWith("o1") || lower.startsWith("o3")) {
            const cleanID = modelID.replace(/^openai\//i, "")
            return gateway(openai.chat(cleanID))
          }
          return gateway(unified(modelID))
        }

        evt.sdk = Object.assign(
          (modelID: string) => wrapModel(resolveModel(modelID)),
          gateway,
          {
            languageModel(modelID: string) {
              return wrapModel(resolveModel(modelID))
            },
          }
        )
      })
    )

    yield* ctx.aisdk.language((evt) =>
      Effect.sync(() => {
        if (evt.model.providerID !== "cloudflare-ai-gateway-byok") return
        if (!evt.sdk) return

        if (typeof evt.sdk.languageModel === "function") {
          evt.language = evt.sdk.languageModel(evt.model.api.id)
        } else {
          console.warn(
            "[CloudflareAIGatewayBYOK] Expected sdk.languageModel to be a function, but got:",
            typeof evt.sdk.languageModel
          )
        }
      })
    )
  })
