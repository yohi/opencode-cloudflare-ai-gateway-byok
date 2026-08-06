import { Effect } from "effect"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"

export const CloudflareAIGatewayBYOK = (ctx: PluginContext) =>
  Effect.gen(function* () {
    yield* ctx.aisdk.sdk((evt) =>
      Effect.gen(function* () {
        if (evt.package !== "ai-gateway-provider") return
        if (evt.options.baseURL !== undefined) return

        const config = gatewayConfig(evt.options)
        if (config === undefined) return

        const { accountId, gatewayId, apiKey } = config
        const metadata = gatewayMetadata(evt.options)
        const options = gatewayOptions(evt.options, metadata)

        const { createAiGateway } = yield* Effect.promise(
          () => import("ai-gateway-provider")
        ).pipe(Effect.orDie)

        evt.sdk = createAiGateway({
          accountId,
          gateway: gatewayId,
          apiKey,
          options,
        })
      })
    )

    yield* ctx.aisdk.language((evt) =>
      Effect.gen(function* () {
        if (evt.model.providerID !== "cloudflare-ai-gateway-byok") return
        if (!evt.sdk) return

        const { createUnified } = yield* Effect.promise(
          () => import("ai-gateway-provider/providers/unified")
        ).pipe(Effect.orDie)

        const unified = createUnified({})
        evt.language = evt.sdk(unified(evt.model.api.id))
      })
    )
  })
