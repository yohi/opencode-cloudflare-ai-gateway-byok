import { Effect } from "effect"
import { gatewayConfig, gatewayMetadata, gatewayOptions } from "./env.js"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"

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
          } catch (e) {}
        }
        return originalFetch(input, { ...init, headers })
      }
      return originalFetch(input, init)
    },
    originalFetch,
  )
}

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
              const headers = new Headers(init?.headers)
              headers.delete("authorization")
              headers.delete("Authorization")

                if (init && init.body && typeof init.body === "string") {
                try {
                  const parsed = JSON.parse(init.body)
                  if (Array.isArray(parsed.tools) && parsed.tools.length > 128) {
                    parsed.tools = parsed.tools.slice(0, 128)
                  }
                  if (parsed.max_tokens !== undefined) {
                    parsed.max_completion_tokens = parsed.max_completion_tokens ?? parsed.max_tokens
                    delete parsed.max_tokens
                  }
                  return fetch(
                    new Request(input, {
                      ...init,
                      headers,
                      body: JSON.stringify(parsed),
                    })
                  )
                } catch (e) {}
              }
              return fetch(input, { ...init, headers })
            },
            fetch,
          ),
        })

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
