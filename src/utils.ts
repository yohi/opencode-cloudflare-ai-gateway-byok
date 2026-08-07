export function cleanParams(obj: any): void {
  if (!obj || typeof obj !== "object") return
  if (Array.isArray(obj)) {
    for (const item of obj) cleanParams(item)
    return
  }
  if (Array.isArray(obj.tools) && obj.tools.length > 0) {
    if (obj.tools.length > 128) {
      obj.tools = obj.tools.slice(0, 128)
    }
    if (obj.reasoning_effort === undefined && obj.reasoningEffort === undefined) {
      obj.reasoning_effort = "none"
    }
  }
  if (obj.max_tokens !== undefined) {
    obj.max_completion_tokens = obj.max_completion_tokens ?? obj.max_tokens
    delete obj.max_tokens
  }
  if (obj.query && typeof obj.query === "object") {
    cleanParams(obj.query)
  }
}

export function wrapModel(model: any) {
  if (!model || typeof model !== "object") return model
  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === "doStream" || prop === "doGenerate") {
        if (typeof target[prop] !== "function") {
          return undefined
        }
        return (options: any) => {
          if (options) {
            const newOpts = { ...options }
            if (Array.isArray(newOpts.tools) && newOpts.tools.length > 128) {
              newOpts.tools = newOpts.tools.slice(0, 128)
            }
            if (newOpts.maxTokens !== undefined) {
              delete newOpts.maxTokens
            }
            if (newOpts.reasoningEffort !== undefined) {
              newOpts.reasoning_effort = newOpts.reasoningEffort
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

export function patchGlobalFetch(): void {
  if ((globalThis as any).__byok_fetch_patched__) return
  ;(globalThis as any).__byok_fetch_patched__ = true
  const originalFetch = globalThis.fetch

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
          } catch (e) {
            console.warn("[CloudflareAIGatewayBYOK] Failed to clone/read request body:", e)
          }
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
