export interface CapturedRequest {
  accountId: string
  gatewayId: string
  provider: string
  headers: Record<string, string>
  body: unknown
}

export interface MockGateway {
  url: string
  port: number
  requests: CapturedRequest[]
  setResponse(provider: string, response: unknown): void
  setStatus(provider: string, status: number): void
}

export interface MockGatewayOptions {
  port?: number
  defaultStatus?: number
}

const servers = new WeakMap<MockGateway, { stop(closeActiveConnections?: boolean): void }>()

export async function startMockGateway(options?: MockGatewayOptions): Promise<MockGateway> {
  const captured: CapturedRequest[] = []
  const responses = new Map<string, unknown>()
  const statuses = new Map<string, number>()

  const server = Bun.serve({
    port: options?.port ?? 0,
    hostname: "127.0.0.1",
    async fetch(req: Request) {
      const url = new URL(req.url)
      const match = /^\/accounts\/([^/]+)\/ai\/gateway\/([^/]+)\/([^/]+)$/.exec(url.pathname)
      if (!match || req.method !== "POST") {
        return new Response("Not Found", { status: 404 })
      }

      const [, accountId, gatewayId, provider] = match
      const body = await req.json().catch(() => undefined)
      captured.push({
        accountId,
        gatewayId,
        provider,
        headers: Object.fromEntries(req.headers.entries()),
        body,
      })

      const status = statuses.get(provider) ?? options?.defaultStatus ?? 200
      const responseBody = responses.get(provider) ?? defaultResponse(provider)
      return Response.json(responseBody, { status })
    },
  })

  const gateway: MockGateway = {
    url: `http://${server.hostname}:${server.port}`,
    port: server.port ?? 0,
    requests: captured,
    setResponse(provider, response) {
      responses.set(provider, response)
    },
    setStatus(provider, status) {
      statuses.set(provider, status)
    },
  }

  servers.set(gateway, server)
  return gateway
}

export async function stopMockGateway(gateway: MockGateway): Promise<void> {
  servers.get(gateway)?.stop(true)
  servers.delete(gateway)
}

function defaultResponse(provider: string): unknown {
  if (provider === "openai") {
    return {
      id: "chatcmpl-mock",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello from mock" } }],
    }
  }
  if (provider === "anthropic") {
    return {
      id: "msg_01mock",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello from mock" }],
      model: "claude-sonnet-4",
    }
  }
  return { ok: true }
}
