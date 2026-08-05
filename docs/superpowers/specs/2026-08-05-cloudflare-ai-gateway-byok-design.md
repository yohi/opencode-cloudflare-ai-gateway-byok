# Cloudflare AI Gateway BYOK Plugin Design

## 1. Purpose

OpenCode ships a built-in `cloudflare-ai-gateway` provider that forwards requests to Cloudflare AI Gateway. In its default configuration, the user still has to supply a separate API key for each upstream LLM provider (for example, `Authorization: Bearer YOUR_OPENAI_API_KEY` in addition to `cf-aig-authorization`).

Cloudflare AI Gateway also supports **BYOK (Bring Your Own Key)**, where the upstream provider keys are stored and managed on the Cloudflare side. In that mode the client only sends the gateway token:

```bash
curl https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai/chat/completions \
  -H 'cf-aig-authorization: Bearer {CF_AIG_TOKEN}' \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

This design defines an independent npm plugin, `opencode-cloudflare-ai-gateway-byok`, that adds a new OpenCode provider using BYOK semantics while reusing as much of the built-in `cloudflare-ai-gateway` source as possible.

## 2. Scope

- A single new OpenCode provider ID: `cloudflare-ai-gateway-byok`.
- Model IDs use the `provider/model` form (for example, `openai/gpt-4o`, `anthropic/claude-sonnet-4`).
- Authentication uses only the Cloudflare gateway token (`cf-aig-authorization`); upstream provider API keys are not sent from the client.
- Credentials can come from `/connect`, `opencode.json`, or the same environment variables used by the built-in provider.
- The plugin is published as an npm package on GitHub Packages.

## 3. Architecture

```
OpenCode (/connect or opencode.json)
  │
  ▼
Provider ID: cloudflare-ai-gateway-byok
  │
  ▼
opencode-cloudflare-ai-gateway-byok plugin
  │
  ▼
ai-gateway-provider: createAiGateway + createUnified
  │
  ▼
Cloudflare AI Gateway (BYOK)
  │
  ▼
OpenAI / Anthropic / Google / Workers AI / etc.
```

### Core logic

The plugin mirrors the built-in `cloudflare-ai-gateway` plugin in `packages/core/src/plugin/provider/cloudflare-ai-gateway.ts`. The only semantic change is the call to `createUnified`:

```ts
// Built-in provider (non-BYOK)
const unified = createUnified({ apiKey: config.apiKey })

// BYOK provider
const unified = createUnified({})
```

Everything else—gateway URL construction, `cf-aig-authorization`, metadata headers, cache options, and User-Agent—is kept identical.

## 4. Components

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entry point, exports the OpenCode `Plugin` function. |
| `src/cloudflare-ai-gateway-byok.ts` | Core provider logic, registers the `ctx.aisdk.sdk` hook. |
| `src/env.ts` | Resolves account, gateway, and token from environment variables and config options. |
| `test/cloudflare-ai-gateway-byok.test.ts` | Tests based on the built-in provider's test file, adapted for BYOK behavior. |
| `package.json` | GitHub Packages npm configuration, peer dependencies, scripts. |
| `README.md` | Installation and configuration instructions. |

## 5. Provider ID and Model Mapping

- **Provider ID:** `cloudflare-ai-gateway-byok`
- **Model ID format:** `provider/model`, passed unchanged to `createUnified`.
- Cloudflare's Unified API determines the upstream provider from the model prefix, and BYOK injects the stored key on the gateway side.

Example `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@opencode-ai/cloudflare-ai-gateway-byok"],
  "provider": {
    "cloudflare-ai-gateway-byok": {
      "name": "Cloudflare AI Gateway (BYOK)",
      "models": {
        "openai/gpt-4o": {},
        "anthropic/claude-sonnet-4": {}
      }
    }
  }
}
```

## 6. Configuration and Authentication

### `/connect`

1. Search for **Cloudflare AI Gateway BYOK**.
2. Enter **Account ID**.
3. Enter **Gateway ID**.
4. Enter **Cloudflare API token**.
5. Run `/models` to choose a model.

### Environment variables

The plugin uses the same variable names as the built-in provider so migration is trivial:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-32-character-account-id
export CLOUDFLARE_GATEWAY_ID=your-gateway-id
export CLOUDFLARE_API_TOKEN=your-api-token
```

`CF_AIG_TOKEN` is accepted as a fallback when `CLOUDFLARE_API_TOKEN` is not set.

### `opencode.json`

```json
{
  "provider": {
    "cloudflare-ai-gateway-byok": {
      "options": {
        "accountId": "your-account-id",
        "gatewayId": "your-gateway-id",
        "apiKey": "your-api-token"
      }
    }
  }
}
```

### Precedence

1. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_GATEWAY_ID` environment variables.
2. `CLOUDFLARE_API_TOKEN` environment variable.
3. `CF_AIG_TOKEN` environment variable (fallback).
4. Values from `/connect` or `opencode.json` (`accountId`, `gatewayId` or `gateway`, `apiKey`).

## 7. Implementation Details

### Plugin entry point

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { CloudflareAIGatewayBYOK } from "./cloudflare-ai-gateway-byok"

export const CloudflareAIGatewayBYOKPlugin: Plugin = async (ctx) => {
  await CloudflareAIGatewayBYOK(ctx)
}
```

### Core hook

```ts
import os from "os"
import { Effect } from "effect"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

export const CloudflareAIGatewayBYOK = (ctx: PluginContext) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* ctx.aisdk.sdk(
        Effect.fn(function* (evt) {
          if (evt.package !== "ai-gateway-provider") return
          if (evt.options.baseURL) return

          const config = gatewayConfig(evt.options)
          if (!config) return

          const metadata = gatewayMetadata(evt.options)
          const { createAiGateway } = yield* Effect.promise(() =>
            import("ai-gateway-provider")
          ).pipe(Effect.orDie)
          const { createUnified } = yield* Effect.promise(() =>
            import("ai-gateway-provider/providers/unified")
          ).pipe(Effect.orDie)

          const gateway = createAiGateway({
            accountId: config.accountId,
            gateway: config.gatewayId,
            apiKey: config.apiKey,
            options: gatewayOptions(evt.options, metadata),
          } as any)

          // BYOK: do not pass upstream provider API keys to createUnified
          const unified = createUnified({})

          evt.sdk = {
            languageModel(modelID: string) {
              return gateway(unified(modelID))
            },
          }
        })
      )
    })
  )
```

### Helper functions

The following helpers are copied from the built-in provider and kept identical:

- `gatewayConfig(options)` — resolves account, gateway, and token.
- `gatewayMetadata(options)` — resolves `metadata` or parses `cf-aig-metadata` header.
- `gatewayOptions(options, metadata)` — builds gateway options including User-Agent, cache, and log settings.

## 8. Error Handling

| Condition | Behavior |
| --- | --- |
| Missing account, gateway, or token | Do not create an SDK; leave `evt.sdk` undefined so OpenCode can fall back. |
| `baseURL` already set in options | Do not create an SDK; respect the custom proxy / endpoint. |
| Dynamic import of `ai-gateway-provider` fails | Fail fast with `Effect.orDie`. |
| Invalid `provider/model` ID | Pass it through to Cloudflare; let the gateway return the error. |

## 9. Package and Publishing

- **Registry:** GitHub Packages (`https://npm.pkg.github.com`).
- **Package name:** `@opencode-ai/cloudflare-ai-gateway-byok`.
- **Main:** `dist/index.js`.
- **Types:** `dist/index.d.ts`.

### `package.json` outline

```json
{
  "name": "@opencode-ai/cloudflare-ai-gateway-byok",
  "version": "0.1.0",
  "description": "OpenCode plugin for Cloudflare AI Gateway BYOK",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "bun test"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "*",
    "effect": "^3.0.0"
  },
  "dependencies": {
    "ai-gateway-provider": "^0.x"
  },
  "devDependencies": {
    "@types/bun": "*",
    "typescript": "^5.x"
  }
}
```

Exact dependency versions will be pinned during implementation.

## 10. Testing

Tests are adapted from `packages/core/test/plugin/provider-cloudflare-ai-gateway.test.ts`.

Covered scenarios:

1. `createUnified` is called with an empty object (no upstream API key).
2. `createAiGateway` receives account, gateway, and gateway API key.
3. Environment variables take precedence over config values.
4. `CF_AIG_TOKEN` falls back when `CLOUDFLARE_API_TOKEN` is missing.
5. Model IDs are passed through unchanged.
6. SDK is not created when required credentials are missing.
7. SDK is not created when `baseURL` is already configured.
8. Non-`ai-gateway-provider` packages are ignored.

## 11. Risks and Open Questions

- The exact version of `ai-gateway-provider` and its `createUnified` API must be verified during implementation.
- `@opencode-ai/plugin` and `@opencode-ai/core` API surface may differ between OpenCode versions; peer dependency ranges must be chosen carefully.
- GitHub Packages requires authenticated install; documentation must include `.npmrc` setup.

## 12. References

- OpenCode built-in provider: `packages/core/src/plugin/provider/cloudflare-ai-gateway.ts`
- OpenCode built-in provider tests: `packages/core/test/plugin/provider-cloudflare-ai-gateway.test.ts`
- OpenCode plugins docs: `docs/opencode/plugins.mdx`
- OpenCode providers docs: `docs/opencode/providers.mdx`
- Cloudflare AI Gateway BYOK docs: https://developers.cloudflare.com/ai-gateway/
- Reference BYOK setup: `ericallenpaul/opencode-cloudflare-ai-gateway`
