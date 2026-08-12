import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK, DEFAULT_BASE_URL } from "./cloudflare-ai-gateway-byok.js"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"
import { patchGlobalFetch, wrapModel } from "./utils.js"

import { createGoogleGenerativeAI } from "ai-gateway-provider/providers/google"
import { createAnthropic } from "ai-gateway-provider/providers/anthropic"
import { createOpenAI } from "ai-gateway-provider/providers/openai"

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
  const google = createGoogleGenerativeAI()
  const anthropic = createAnthropic()
  const openai = createOpenAI()

  function resolveModel(modelId: string) {
    const lower = modelId.toLowerCase()
    if (lower.startsWith("google/") || lower.startsWith("google-ai-studio/") || lower.includes("gemini")) {
      const cleanID = modelId.replace(/^(google-ai-studio|google)\//i, "")
      return gateway(google(cleanID))
    }
    if (lower.startsWith("anthropic/") || lower.includes("claude")) {
      const cleanID = modelId.replace(/^anthropic\//i, "")
      return gateway(anthropic(cleanID))
    }
    if (lower.startsWith("openai/") || lower.includes("gpt") || lower.startsWith("o1") || lower.startsWith("o3")) {
      const cleanID = modelId.replace(/^openai\//i, "")
      return gateway(openai.chat(cleanID))
    }
    return gateway(unified(modelId))
  }

  return {
    languageModel(modelId: string) {
      return wrapModel(resolveModel(modelId))
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

