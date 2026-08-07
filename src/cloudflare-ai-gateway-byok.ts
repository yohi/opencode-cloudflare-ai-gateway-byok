import { Effect } from "effect"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { cleanParams, patchGlobalFetch, wrapModel } from "./utils.js"

patchGlobalFetch()

export const CloudflareAIGatewayBYOK = (ctx: PluginContext) =>
  Effect.gen(function* () {
    if (ctx.catalog?.transform) {
      yield* ctx.catalog.transform(({ provider }) => {
        provider.update("cloudflare-ai-gateway-byok", (p) => {
          if (p.api && p.api.type === "aisdk" && !p.api.url) {
            p.api.url = "https://gateway.ai.cloudflare.com/v1/compat"
          }
        })
      })
    }

    yield* ctx.aisdk.sdk((evt) =>
      Effect.gen(function* () {
        if (evt.package !== "@yohi/cloudflare-ai-gateway-byok") return
        const customBaseURL = evt.options.baseURL
        evt.options.baseURL = customBaseURL ?? "https://gateway.ai.cloudflare.com/v1/compat"

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

        const gateway = createAiGateway({
          accountId,
          gateway: gatewayId,
          apiKey,
          options,
        })
        const unified = createUnified({
          baseURL: "https://gateway.ai.cloudflare.com/v1/compat",
          fetch: Object.assign(
            (input: any, init?: any) => {
              const isRequest = typeof input === "object" && input !== null && typeof input.url === "string"
              const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined))
              headers.delete("authorization")
              headers.delete("Authorization")

              if (init && init.body && typeof init.body === "string") {
                try {
                  const parsed = JSON.parse(init.body)
                  cleanParams(parsed)
                  return fetch(
                    new Request(input, {
                      ...init,
                      headers,
                      body: JSON.stringify(parsed),
                    })
                  )
                } catch (e) {
                  console.warn("[CloudflareAIGatewayBYOK] Failed to parse request body JSON:", e)
                }
              }
              return fetch(input, { ...init, headers })
            },
            fetch,
          ),
        })

        evt.sdk = Object.assign(
          (modelID: string) => wrapModel(gateway(unified(modelID))),
          gateway,
          {
            languageModel(modelID: string) {
              return wrapModel(gateway(unified(modelID)))
            },
          }
        )
      })
    )

    yield* ctx.aisdk.language((evt) =>
      Effect.gen(function* () {
        if (evt.model.providerID !== "cloudflare-ai-gateway-byok") return
        if (!evt.sdk) return

        if (typeof evt.sdk.languageModel === "function") {
          evt.language = evt.sdk.languageModel(evt.model.api.id)
        }
      })
    )
  })
