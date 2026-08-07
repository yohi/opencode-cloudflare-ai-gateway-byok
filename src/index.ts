import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK, DEFAULT_BASE_URL } from "./cloudflare-ai-gateway-byok.js"
import { gatewayConfig, gatewayMetadata, gatewayOptions, stringOption } from "./env.js"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"
import { patchGlobalFetch, wrapModel } from "./utils.js"

export function createCloudflareAIGatewayBYOK(options: Record<string, unknown> = {}) {
  patchGlobalFetch()
  const config = gatewayConfig(options)
  const nested =
    (typeof options.settings === "object" && options.settings !== null
      ? (options.settings as Record<string, unknown>)
      : undefined) ??
    (typeof options.options === "object" && options.options !== null
      ? (options.options as Record<string, unknown>)
      : undefined)

  const accountId =
    config?.accountId ??
    ((typeof process !== "undefined" && process.env?.CLOUDFLARE_ACCOUNT_ID) || "") ??
    stringOption(options, "accountId") ??
    stringOption(nested, "accountId") ??
    ""

  const gatewayId =
    config?.gatewayId ??
    ((typeof process !== "undefined" && process.env?.CLOUDFLARE_GATEWAY_ID) || "") ??
    stringOption(options, "gatewayId") ??
    stringOption(options, "gateway") ??
    stringOption(nested, "gatewayId") ??
    stringOption(nested, "gateway") ??
    ""

  const apiKey =
    config?.apiKey ??
    ((typeof process !== "undefined" && (process.env?.CLOUDFLARE_API_TOKEN || process.env?.CF_AIG_TOKEN)) || "") ??
    stringOption(options, "apiKey") ??
    stringOption(nested, "apiKey") ??
    ""


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

