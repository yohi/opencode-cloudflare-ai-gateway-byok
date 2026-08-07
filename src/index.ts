import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK } from "./cloudflare-ai-gateway-byok.js"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import { createAiGateway } from "ai-gateway-provider"
import { createUnified } from "ai-gateway-provider/providers/unified"

if (!(globalThis as any).__byok_fetch_patched__) {
  ;(globalThis as any).__byok_fetch_patched__ = true
  const originalFetch = globalThis.fetch

  const cleanParams = (obj: any) => {
    if (!obj || typeof obj !== "object") return
    if (Array.isArray(obj)) {
      for (const item of obj) cleanParams(item)
      return
    }
    if (Array.isArray(obj.tools) && obj.tools.length > 0) {
      if (obj.tools.length > 128) {
        obj.tools = obj.tools.slice(0, 128)
      }
      obj.reasoning_effort = "none"
    }
    if (obj.max_tokens !== undefined) {
      obj.max_completion_tokens = obj.max_completion_tokens ?? obj.max_tokens
      delete obj.max_tokens
    }
    if (obj.query && typeof obj.query === "object") {
      cleanParams(obj.query)
    }
  }

  globalThis.fetch = Object.assign(
    async (input: any, init?: any) => {
      const isRequest = typeof input === "object" && input !== null && typeof input.url === "string"
      const urlStr = isRequest ? input.url : typeof input === "string" ? input : ""
      if (urlStr.includes("gateway.ai.cloudflare.com")) {
        const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined))
        headers.delete("authorization")
        headers.delete("Authorization")

        let bodyStr: string | undefined
        if (typeof init?.body === "string") {
          bodyStr = init.body
        } else if (isRequest) {
          try {
            bodyStr = await input.clone().text()
          } catch (e) {}
        }

        if (bodyStr) {
          try {
            const parsed = JSON.parse(bodyStr)
            cleanParams(parsed)
            return originalFetch(
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
        return originalFetch(input, { ...init, headers })
      }
      return originalFetch(input, init)
    },
    originalFetch,
  )
}

function wrapModel(model: any) {
  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === "doStream" || prop === "doGenerate") {
        return (options: any) => {
          if (options) {
            const newOpts = { ...options }
            if (Array.isArray(newOpts.tools) && newOpts.tools.length > 128) {
              newOpts.tools = newOpts.tools.slice(0, 128)
            }
            if (newOpts.maxTokens !== undefined) {
              delete newOpts.maxTokens
            }
            if (newOpts.reasoningEffort === "none" || newOpts.reasoning_effort === "none") {
              newOpts.reasoning_effort = "none"
              delete newOpts.reasoningEffort
            }
            options = newOpts
          }
          return target[prop](options)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

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
