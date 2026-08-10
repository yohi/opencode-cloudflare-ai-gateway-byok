function sanitizeReasoningEffort(record: Record<string, unknown>, isOpenAI: boolean): void {
  if (isOpenAI) {
    if (record.reasoningEffort !== undefined) {
      record.reasoning_effort = record.reasoningEffort
      delete record.reasoningEffort
    }
    if (Array.isArray(record.tools) && record.tools.length > 0) {
      if (record.tools.length > 128) {
        record.tools = record.tools.slice(0, 128)
      }
      record.reasoning_effort = "none"
    }
  } else {
    delete record.reasoning_effort
    delete record.reasoningEffort
  }
}

function sanitizeMaxTokens(record: Record<string, unknown>): void {
  if (
    record.maxTokens !== undefined ||
    record.max_tokens !== undefined ||
    record.maxOutputTokens !== undefined ||
    record.max_completion_tokens !== undefined
  ) {
    const val = record.maxTokens ?? record.max_tokens ?? record.maxOutputTokens ?? record.max_completion_tokens
    record.max_completion_tokens = val
    delete record.maxTokens
    delete record.max_tokens
    delete record.maxOutputTokens
  }
}

export function cleanParams(obj: unknown): void {
  if (!obj || typeof obj !== "object") return
  if (Array.isArray(obj)) {
    for (const item of obj) cleanParams(item)
    return
  }
  const record = obj as Record<string, unknown>

  const modelName = typeof record.model === "string" ? record.model.toLowerCase() : ""
  const isOpenAI = modelName.includes("openai") || modelName.includes("gpt") || modelName.startsWith("o1") || modelName.startsWith("o3")

  sanitizeReasoningEffort(record, isOpenAI)
  sanitizeMaxTokens(record)

  for (const key of Object.keys(record)) {
    if (key === "maxTokens" || key === "max_tokens" || key === "maxOutputTokens") continue
    if (record[key] && typeof record[key] === "object") {
      cleanParams(record[key])
    }
  }
}

export function wrapModel<T>(model: T): T {
  if (!model || typeof model !== "object") return model
  return new Proxy(model as object, {
    get(target: Record<string | symbol, unknown>, prop: string | symbol, receiver: unknown) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === "doStream" || prop === "doGenerate") {
        if (typeof value !== "function") {
          return undefined
        }
        const fn = value as (...args: unknown[]) => unknown
        return (options: Record<string, unknown>, ...args: unknown[]) => {
          if (options && typeof options === "object") {
            cleanParams(options)
          }
          return fn.call(target, options, ...args)
        }
      }
      return value
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

function cleanHeaders(headers: Headers, hostname: string): void {
  if (hostname === "gateway.ai.cloudflare.com") {
    headers.delete("authorization")
    headers.delete("Authorization")
  }
}

function processFetchRequest(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  hostname: string,
  isRequest: boolean,
  parsed: unknown,
  originalFetch: typeof fetch
): Promise<Response> {
  const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined))
  cleanHeaders(headers, hostname)

  if (isRequest) {
    return originalFetch(
      new Request(input as Request, {
        headers,
        body: JSON.stringify(parsed),
      })
    )
  }

  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : ""
  return originalFetch(
    new Request(urlStr, {
      ...init,
      headers,
      body: JSON.stringify(parsed),
    })
  )
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

      const bodyStr = await extractBodyString(input, init)
      if (bodyStr) {
        try {
          const parsed = JSON.parse(bodyStr)
          cleanParams(parsed)
          return await processFetchRequest(input, init, hostname, isRequest, parsed, originalFetch)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          console.warn(`[CloudflareAIGatewayBYOK] Failed to parse request body JSON: ${msg}`)
        }
      }

      if (hostname === "gateway.ai.cloudflare.com") {
        const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined))
        cleanHeaders(headers, hostname)
        return originalFetch(input, { ...init, headers })
      }

      return originalFetch(input, init)
    },
    originalFetch,
  )
}

