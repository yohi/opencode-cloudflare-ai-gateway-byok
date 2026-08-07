import { Option, Schema } from "effect"
import type { AiGatewayOptions } from "ai-gateway-provider"

type GatewayConfig = {
  accountId: string
  gatewayId: string
  apiKey: string
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function getEnvVar(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[name] || undefined
  }
  return undefined
}

export function getNestedOptions(
  options: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
  if (!options || typeof options !== "object") return undefined
  return (
    (typeof options.settings === "object" && options.settings !== null
      ? (options.settings as Record<string, unknown>)
      : undefined) ??
    (typeof options.options === "object" && options.options !== null
      ? (options.options as Record<string, unknown>)
      : undefined)
  )
}

export function gatewayConfig(options: Record<string, unknown> | null | undefined): GatewayConfig | undefined {
  if (!options || typeof options !== "object") return undefined
  const nested = getNestedOptions(options)

  const accountId =
    getEnvVar("CLOUDFLARE_ACCOUNT_ID") ??
    stringOption(options, "accountId") ??
    stringOption(nested, "accountId")

  const gatewayId =
    getEnvVar("CLOUDFLARE_GATEWAY_ID") ??
    stringOption(options, "gatewayId") ??
    stringOption(options, "gateway") ??
    stringOption(nested, "gatewayId") ??
    stringOption(nested, "gateway")

  const apiKey =
    getEnvVar("CLOUDFLARE_API_TOKEN") ??
    getEnvVar("CF_AIG_TOKEN") ??
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
  const nested = getNestedOptions(options)

  const cacheTtl =
    typeof options.cacheTtl === "number"
      ? options.cacheTtl
      : typeof nested?.cacheTtl === "number"
      ? nested.cacheTtl
      : undefined

  const cacheKey =
    typeof options.cacheKey === "string"
      ? options.cacheKey
      : typeof nested?.cacheKey === "string"
      ? nested.cacheKey
      : undefined

  const skipCache =
    typeof options.skipCache === "boolean"
      ? options.skipCache
      : typeof nested?.skipCache === "boolean"
      ? nested.skipCache
      : undefined

  const collectLog =
    typeof options.collectLog === "boolean"
      ? options.collectLog
      : typeof nested?.collectLog === "boolean"
      ? nested.collectLog
      : undefined

  return {
    metadata,
    cacheTtl,
    cacheKey,
    skipCache,
    collectLog,
  }
}

export function stringOption(options: Record<string, unknown> | null | undefined, key: string): string | undefined {
  if (!options || typeof options !== "object") return undefined
  const val = typeof options[key] === "string" ? (options[key] as string) : undefined
  if (!val) return undefined

  const match = /^\{env:(.+)\}$/.exec(val)
  return match?.[1] ? getEnvVar(match[1]) : val
}

