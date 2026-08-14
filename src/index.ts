import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK, DEFAULT_BASE_URL } from "./cloudflare-ai-gateway-byok.js"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"
import { normalizeModelCallOptions, patchGlobalFetch, wrapModel } from "./utils.js"

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
  const parsedOptions = gatewayOptions(opts, gatewayMetadata(opts))
  const customOpenAI = (customPath: string, modelID: string) => {
    const provider = createOpenAI({
      baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${customPath}/v1`,
      apiKey: "CF_TEMP_TOKEN",
      headers: {
        "cf-aig-authorization": `Bearer ${apiKey}`,
        "cf-aig-collect-log-payload": parsedOptions.collectLog !== undefined ? String(parsedOptions.collectLog) : "true",
        "cf-aig-max-attempts": "1",
        "cf-aig-skip-cache": parsedOptions.skipCache !== undefined ? String(parsedOptions.skipCache) : "true",
      },
    })
    const chatModel = provider.chat(modelID) as Record<string, unknown>
    const responsesModel = provider.responses(modelID) as Record<string, unknown>
    return {
      __byokResponseAware: true,
      ...chatModel,
      doGenerate(options: Record<string, unknown>, ...args: unknown[]) {
        const model = Array.isArray(options.tools) && options.tools.length > 0 ? responsesModel : chatModel
        normalizeModelCallOptions(options, model === responsesModel ? "responses" : "chat")
        return Reflect.apply(model.doGenerate as (...values: unknown[]) => unknown, model, [options, ...args])
      },
      doStream(options: Record<string, unknown>, ...args: unknown[]) {
        const model = Array.isArray(options.tools) && options.tools.length > 0 ? responsesModel : chatModel
        normalizeModelCallOptions(options, model === responsesModel ? "responses" : "chat")
        return Reflect.apply(model.doStream as (...values: unknown[]) => unknown, model, [options, ...args])
      },
    }
  }

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
    if (lower.startsWith("openai/") || lower.startsWith("o1") || lower.startsWith("o3")) {
      const cleanID = modelId.replace(/^openai\//i, "")
      return gateway(openai.chat(cleanID))
    }
    const customPathMatch = /^([^/]+)\/(.+)$/.exec(modelId)
    if (customPathMatch && !lower.startsWith("dynamic/")) {
      return wrapModel(customOpenAI(customPathMatch[1], customPathMatch[2]))
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
