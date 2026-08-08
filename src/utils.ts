export function cleanParams(obj: unknown): void {
  if (!obj || typeof obj !== "object") return
  if (Array.isArray(obj)) {
    for (const item of obj) cleanParams(item)
    return
  }
  const record = obj as Record<string, unknown>
  if (Array.isArray(record.tools) && record.tools.length > 0) {
    if (record.tools.length > 128) {
      record.tools = record.tools.slice(0, 128)
    }
    if (record.reasoning_effort !== undefined) {
      record.reasoning_effort = "none"
    }
  }
  if (record.max_tokens !== undefined) {
    record.max_completion_tokens = record.max_completion_tokens ?? record.max_tokens
    delete record.max_tokens
  }
  if (record.query && typeof record.query === "object") {
    cleanParams(record.query)
  }
}

export function wrapModel<T>(model: T): T {
  if (!model || typeof model !== "object") return model
  return new Proxy(model as object, {
    get(target: Record<string | symbol, unknown>, prop: string | symbol, receiver: unknown) {
      if (prop === "doStream" || prop === "doGenerate") {
        if (typeof target[prop] !== "function") {
          return undefined
        }
        return (options: Record<string, unknown>) => {
          if (options) {
            const newOpts = { ...options }
            if (Array.isArray(newOpts.tools) && newOpts.tools.length > 0) {
              if (newOpts.tools.length > 128) {
                newOpts.tools = newOpts.tools.slice(0, 128)
              }
              if (newOpts.reasoningEffort !== undefined) {
                newOpts.reasoningEffort = "none"
              }
              if (newOpts.reasoning_effort !== undefined) {
                newOpts.reasoning_effort = "none"
              }
            } else if (newOpts.reasoningEffort !== undefined) {
              newOpts.reasoning_effort = newOpts.reasoningEffort
              delete newOpts.reasoningEffort
            }
            if (newOpts.maxTokens !== undefined) {
              newOpts.maxOutputTokens = newOpts.maxOutputTokens ?? newOpts.maxTokens
              delete newOpts.maxTokens
            }
            options = newOpts
          }
          return (target[prop] as Function)(options)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as T
}

async function extractBodyString(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<string | undefined> {
  if (typeof init?.body === "string") {
    return init.body
  }
  if (typeof input === "object" && input !== null && "url" in input && typeof input.url === "string" && typeof (input as Request).clone === "function") {
    try {
      return await (input as Request).clone().text()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[CloudflareAIGatewayBYOK] Failed to clone/read request body: ${msg}`)
    }
  }
  return undefined
}

export function patchGlobalFetch(): void {
  if ((globalThis as Record<string, unknown>).__byok_fetch_patched__) return
  ;(globalThis as Record<string, unknown>).__byok_fetch_patched__ = true
  const originalFetch = globalThis.fetch

  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {

      const isRequest = typeof input === "object" && input !== null && "url" in input && typeof (input as Request).url === "string"
      const urlStr = isRequest
        ? (input as Request).url
        : typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : ""

      let hostname = ""
      try {
        hostname = new URL(urlStr).hostname
      } catch {
        // invalid URL or empty
      }

      if (hostname !== "gateway.ai.cloudflare.com") {
        return originalFetch(input, init)
      }

      const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined))
      headers.delete("authorization")
      headers.delete("Authorization")

      const bodyStr = await extractBodyString(input, init)
      if (bodyStr) {
        try {
          const parsed = JSON.parse(bodyStr)
          cleanParams(parsed)
          return originalFetch(
            new Request(urlStr, {
              ...init,
              headers,
              body: JSON.stringify(parsed),
            })
          )

        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          console.warn(`[CloudflareAIGatewayBYOK] Failed to parse request body JSON: ${msg}`)
        }
      }
      return originalFetch(input, { ...init, headers })
    },
    originalFetch,
  )
}

