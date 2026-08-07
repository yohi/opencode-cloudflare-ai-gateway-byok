import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK } from "./cloudflare-ai-gateway-byok.js"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"
import { patchGlobalFetch, wrapModel } from "./utils.js"

patchGlobalFetch()

export function createCloudflareAIGatewayBYOK(options: Record<string, unknown> = {}) {
  const config = gatewayConfig(options)
  const accountId = config?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? ""
  const gatewayId = config?.gatewayId ?? process.env.CLOUDFLARE_GATEWAY_ID ?? ""
  const apiKey = config?.apiKey ?? process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_AIG_TOKEN ?? ""

  const metadata = gatewayMetadata(options)
  const opts = gatewayOptions(options, metadata)

  const gateway = createAiGateway({
    accountId,
    gateway: gatewayId,
    apiKey,
    options: opts,
  })
  const unified = createUnified({
    baseURL: "https://gateway.ai.cloudflare.com/v1/compat",
  })

  return {
    languageModel(modelId: string) {
      return wrapModel(gateway(unified(modelId)))
    },
  }
}

export default define({
  id: "@yohi/cloudflare-ai-gateway-byok",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* CloudflareAIGatewayBYOK(ctx)
    }),
}) satisfies Plugin
