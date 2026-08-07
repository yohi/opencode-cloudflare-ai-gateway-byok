import { Option, Schema } from "effect"
import type { AiGatewayOptions } from "ai-gateway-provider"

type GatewayConfig = {
  accountId: string
  gatewayId: string
  apiKey: string
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

export function gatewayConfig(options: Record<string, unknown> | null | undefined): GatewayConfig | undefined {
  if (!options || typeof options !== "object") return undefined
  const nested =
    (typeof options.settings === "object" && options.settings !== null
      ? (options.settings as Record<string, unknown>)
      : undefined) ??
    (typeof options.options === "object" && options.options !== null
      ? (options.options as Record<string, unknown>)
      : undefined)

  const accountId =
    (process.env.CLOUDFLARE_ACCOUNT_ID || undefined) ??
    stringOption(options, "accountId") ??
    stringOption(nested, "accountId")

  const gatewayId =
    (process.env.CLOUDFLARE_GATEWAY_ID || undefined) ??
    stringOption(options, "gatewayId") ??
    stringOption(options, "gateway") ??
    stringOption(nested, "gatewayId") ??
    stringOption(nested, "gateway")

  const apiKey =
    (process.env.CLOUDFLARE_API_TOKEN || undefined) ??
    (process.env.CF_AIG_TOKEN || undefined) ??
    stringOption(options, "apiKey") ??
    stringOption(nested, "apiKey")

  if (!accountId || !gatewayId || !apiKey) return undefined

  return { accountId, gatewayId, apiKey }
}

export function gatewayMetadata(options: Record<string, unknown> | null | undefined): AiGatewayOptions["metadata"] {
  if (!options || typeof options !== "object") return undefined
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
  options: Record<string, unknown> | null | undefined,
  metadata: AiGatewayOptions["metadata"],
): AiGatewayOptions {
  if (!options || typeof options !== "object") {
    return { metadata }
  }
  return {
    metadata,
    cacheTtl: typeof options.cacheTtl === "number" ? options.cacheTtl : undefined,
    cacheKey: typeof options.cacheKey === "string" ? options.cacheKey : undefined,
    skipCache: typeof options.skipCache === "boolean" ? options.skipCache : undefined,
    collectLog: typeof options.collectLog === "boolean" ? options.collectLog : undefined,
  }
}

export function stringOption(options: Record<string, unknown> | null | undefined, key: string): string | undefined {
  if (!options || typeof options !== "object") return undefined
  const val = typeof options[key] === "string" ? (options[key] as string) : undefined
  if (!val) return undefined

  const match = /^\{env:(.+)\}$/.exec(val)
  return match?.[1] ? process.env[match[1]] || undefined : val
}
