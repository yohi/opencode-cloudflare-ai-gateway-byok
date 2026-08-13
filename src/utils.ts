function sanitizeOpenAIReasoningEffort(record: Record<string, unknown>, api: "chat" | "responses"): void {
  const reasoningEffort = record.reasoningEffort ?? record.reasoning_effort
  if (api === "responses") {
    if (reasoningEffort !== undefined) {
      const reasoning = isRecord(record.reasoning) ? record.reasoning : {}
      record.reasoning = { ...reasoning, effort: reasoningEffort }
    }
    delete record.reasoningEffort
    delete record.reasoning_effort
    return
  }
  if (record.reasoningEffort !== undefined) {
    record.reasoning_effort = record.reasoningEffort
    delete record.reasoningEffort
  }
  if (Array.isArray(record.tools) && record.tools.length > 0) {
    record.reasoning_effort = "none"
  }
}

function sanitizeNonOpenAIReasoningEffort(record: Record<string, unknown>): void {
  delete record.reasoning_effort
  delete record.reasoningEffort
}

function sanitizeReasoningEffort(record: Record<string, unknown>, api: "chat" | "responses"): void {
  const modelName = typeof record.model === "string" ? record.model.toLowerCase() : ""
  const isOpenAI = modelName.includes("openai") || modelName.includes("gpt") || modelName.startsWith("o1") || modelName.startsWith("o3")

  if (isOpenAI) {
    sanitizeOpenAIReasoningEffort(record, api)
  } else {
    sanitizeNonOpenAIReasoningEffort(record)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalizeModelCallOptions(record: Record<string, unknown>, api: "chat" | "responses"): void {
  const maxOutputTokens = record.maxTokens ?? record.max_tokens ?? record.maxOutputTokens ?? record.max_completion_tokens
  if (maxOutputTokens !== undefined) {
    record.maxOutputTokens = maxOutputTokens
    delete record.maxTokens
    delete record.max_tokens
    delete record.max_completion_tokens
  }

  const modelName = typeof record.model === "string" ? record.model.toLowerCase() : ""
  const isOpenAI = modelName.includes("openai") || modelName.includes("gpt") || modelName.startsWith("o1") || modelName.startsWith("o3")
  const reasoningEffort = Array.isArray(record.tools) && record.tools.length > 0
    ? "none"
    : record.reasoningEffort ?? record.reasoning_effort

  if (api === "responses") {
    const reasoning = isRecord(record.reasoning) ? record.reasoning : {}
    record.reasoning = { ...reasoning, effort: reasoningEffort }
  } else if (isOpenAI && reasoningEffort !== undefined) {
    const providerOptions = isRecord(record.providerOptions) ? record.providerOptions : {}
    const openaiOptions = isRecord(providerOptions.openai) ? providerOptions.openai : {}
    record.providerOptions = {
      ...providerOptions,
      openai: { ...openaiOptions, reasoningEffort },
    }
  }
  delete record.reasoningEffort
  delete record.reasoning_effort
}

export function cleanParams(obj: unknown, api: "chat" | "responses" = "chat"): void {
  if (Array.isArray(obj)) {
    for (const entry of obj) {
      if (isRecord(entry) && isRecord(entry.query)) {
        cleanParams(entry.query, api)
      }
    }
    return
  }
  if (!isRecord(obj)) return
  const record = obj

  sanitizeReasoningEffort(record, api)
  sanitizeMaxTokens(record)

  if (record.options && typeof record.options === "object" && !Array.isArray(record.options)) {
    cleanParams(record.options, api)
  }
}

export function wrapModel<T>(model: T): T {
  if (!model || typeof model !== "object") return model

  const obj = model as Record<string, unknown>
  if (obj.__byokResponseAware === true) return model
  for (const method of ["doStream", "doGenerate"] as const) {
    const orig = obj[method]
    if (typeof orig === "function") {
      const fn = orig as (...args: unknown[]) => unknown
      obj[method] = (options: Record<string, unknown>, ...args: unknown[]) => {
        if (options && typeof options === "object") {
          normalizeModelCallOptions(options, "chat")
        }
        return Reflect.apply(fn, obj, [options, ...args])
      }
    }
  }
  return model
}

async function extractBodyString(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<string | undefined> {
  const method = (init?.method ?? (typeof input === "object" && input !== null && "method" in input ? (input as Request).method : "GET")).toUpperCase()
  if (method === "GET" || method === "HEAD") {
    return undefined
  }

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

  const method = (init?.method ?? (isRequest ? (input as Request).method : "GET")).toUpperCase()
  const hasBody = method !== "GET" && method !== "HEAD"

  if (isRequest) {
    const reqInit: RequestInit = {
      ...init,
      headers,
    }
    if (hasBody) {
      reqInit.body = JSON.stringify(parsed)
    }
    return originalFetch(new Request(input as Request, reqInit))
  }

  let urlStr = ""
  if (typeof input === "string") {
    urlStr = input
  } else if (input instanceof URL) {
    urlStr = input.href
  }

  const reqInit: RequestInit = {
    ...init,
    headers,
  }
  if (hasBody) {
    reqInit.body = JSON.stringify(parsed)
  }

  return originalFetch(new Request(urlStr, reqInit))
}

declare global {
  // eslint-disable-next-line no-var
  var __byok_fetch_patched__: boolean | undefined
}

function resolveUrlString(input: Parameters<typeof fetch>[0], isRequest: boolean): string {
  if (isRequest) {
    return (input as Request).url
  }
  if (typeof input === "string") {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  return ""
}

export function patchGlobalFetch(): void {
  if (globalThis.__byok_fetch_patched__) return
  globalThis.__byok_fetch_patched__ = true
  const originalFetch = globalThis.fetch

  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const isRequest = typeof input === "object" && input !== null && "url" in input && typeof (input as Request).url === "string"
      const urlStr = resolveUrlString(input, isRequest)
      const baseURL = process.env.CLOUDFLARE_AIG_BASE_URL
      const rewrittenURL =
        baseURL && urlStr.startsWith("https://gateway.ai.cloudflare.com/")
          ? `${baseURL}${new URL(urlStr).pathname}`
          : undefined
      const rewrittenInput = rewrittenURL === undefined
        ? input
        : isRequest
          ? new Request(rewrittenURL, input as Request)
          : rewrittenURL

      let hostname = ""
      try {
        hostname = new URL(urlStr).hostname
      } catch {
        // invalid URL or empty
      }

      if (hostname === "gateway.ai.cloudflare.com") {
        const api = new URL(urlStr).pathname.endsWith("/responses") ? "responses" : "chat"
        const bodyStr = await extractBodyString(input, init)
        if (bodyStr) {
          try {
            const parsed = JSON.parse(bodyStr)
            cleanParams(parsed, api)
            return await processFetchRequest(rewrittenInput, init, hostname, isRequest, parsed, originalFetch)
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.warn(`[CloudflareAIGatewayBYOK] Failed to parse request body JSON: ${msg}`)
          }
        }

        const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined))
        cleanHeaders(headers, hostname)
        return originalFetch(rewrittenInput, { ...init, headers })
      }

      return originalFetch(rewrittenInput, init)
    },
    originalFetch,
  )
}
