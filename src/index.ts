import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK, DEFAULT_BASE_URL } from "./cloudflare-ai-gateway-byok.js"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"
import { patchGlobalFetch, wrapModel } from "./utils.js"

export function createCloudflareAIGatewayBYOK(options: Record<string, unknown> = {}) {
  patchGlobalFetch()
  const config = gatewayConfig(options)
  if (!config) {
    throw new Error(
      "[CloudflareAIGatewayBYOK] Missing required Cloudflare AI Gateway credentials (accountId, gatewayId, apiKey)."
    )
  }

  const { accountId, gatewayId, apiKey } = config
  const metadata = gatewayMetadata(options)
  const opts = gatewayOptions(options, metadata)

  const gateway = createAiGateway({
    accountId,
    gateway: gatewayId,
    apiKey,
    options: opts,
  })
  const unified = createUnified({
    baseURL: DEFAULT_BASE_URL,
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

