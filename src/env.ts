import os from "node:os"
import { Option, Schema } from "effect"
import type { AiGatewayOptions } from "ai-gateway-provider"


type GatewayConfig = {
  accountId: string
  gatewayId: string
  apiKey: string
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

export function gatewayConfig(options: Record<string, unknown>): GatewayConfig | undefined {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
  const gatewayId =
    process.env.CLOUDFLARE_GATEWAY_ID ?? stringOption(options, "gatewayId") ?? stringOption(options, "gateway")
  const apiKey = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_AIG_TOKEN ?? stringOption(options, "apiKey")
  if (!accountId || !gatewayId || !apiKey) return undefined

  return { accountId, gatewayId, apiKey }
}

export function gatewayMetadata(options: Record<string, unknown>): AiGatewayOptions["metadata"] {
  if (options.metadata !== undefined) return options.metadata as AiGatewayOptions["metadata"]
  const headers =
    typeof options.headers === "object" && options.headers !== null
      ? (options.headers as Record<string, string>)
      : undefined
  const normalizedHeaders = headers
    ? Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
      )
    : undefined
  const raw = normalizedHeaders?.["cf-aig-metadata"]
  return raw
    ? (Option.getOrUndefined(decodeJson(raw)) as AiGatewayOptions["metadata"])
    : undefined
}

export function gatewayOptions(
  options: Record<string, unknown>,
  metadata: AiGatewayOptions["metadata"]
): Record<string, unknown> {
  return {
    metadata,
    cacheTtl: typeof options.cacheTtl === "number" ? options.cacheTtl : undefined,
    cacheKey: typeof options.cacheKey === "string" ? options.cacheKey : undefined,
    skipCache: typeof options.skipCache === "boolean" ? options.skipCache : undefined,
    collectLog: typeof options.collectLog === "boolean" ? options.collectLog : undefined,
    headers: {
      "User-Agent": `opencode cloudflare-ai-gateway-byok (${os.platform()} ${os.release()}; ${os.arch()})`,
    },
  }
}

export function stringOption(options: Record<string, unknown>, key: string): string | undefined {
  return typeof options[key] === "string" ? (options[key] as string) : undefined
}
