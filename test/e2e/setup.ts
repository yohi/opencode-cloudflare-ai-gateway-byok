import { startMockGateway, stopMockGateway, type MockGateway } from "./mock-gateway.ts"

const ENV_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
  "CLOUDFLARE_API_TOKEN",
  "CF_AIG_TOKEN",
  "CLOUDFLARE_AIG_BASE_URL",
]

export function clearEnv(): () => void {
  const original: Record<string, string | undefined> = {}
  for (const key of ENV_KEYS) {
    original[key] = process.env[key]
    delete process.env[key]
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original[key]
      }
    }
  }
}

export function setE2EEnv(
  gateway: MockGateway,
  values: Record<string, string>,
): () => void {
  const original: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key]
    process.env[key] = value
  }
  process.env.CLOUDFLARE_AIG_BASE_URL = gateway.url
  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    delete process.env.CLOUDFLARE_AIG_BASE_URL
  }
}

export async function withMockGateway(
  testFn: (gateway: MockGateway) => Promise<void>,
): Promise<void> {
  const gateway = await startMockGateway()
  try {
    await testFn(gateway)
  } finally {
    await stopMockGateway(gateway)
  }
}
