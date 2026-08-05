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
- Credentials can come from `opencode.json` or the same environment variables used by the built-in provider.
- The plugin is published as an npm package on GitHub Packages.

## 3. Architecture

```text
OpenCode (opencode.json or environment variables)
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
OpenAI / Anthropic / Google / etc. (BYOK upstreams)
```

> **Note on Workers AI:** Workers AI is not a standard BYOK provider. It uses Cloudflare’s own inference service and requires a separate authentication path (Cloudflare API token, not gateway token), model mapping, and integration tests. This design treats Workers AI as out of scope for the BYOK provider flow unless a dedicated Workers AI path is added later.

### Core logic

The plugin mirrors the built-in `cloudflare-ai-gateway` plugin in `packages/core/src/plugin/provider/cloudflare-ai-gateway.ts`. The primary integration path is Cloudflare’s REST API when `ai-gateway-provider` exposes it; otherwise the `createUnified` path is used as a compatibility-only bridge.

```ts
// Built-in provider (non-BYOK)
const unified = createUnified({ apiKey: config.apiKey })

// BYOK provider
const unified = createUnified({})
```

When `createUnified` is used only because the REST API is unavailable, document its compatibility-only status, a planned usage horizon, and a concrete migration plan to the REST API once supported.

Everything else—gateway URL construction, `cf-aig-authorization`, metadata headers, cache options, and User-Agent—is kept identical.

## 4. Components

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entry point, exports the OpenCode `Plugin` object. |
| `src/cloudflare-ai-gateway-byok.ts` | Core provider logic, registers the public auth/provider hook. |
| `src/env.ts` | Resolves account, gateway, and token from environment variables and config options. |
| `test/cloudflare-ai-gateway-byok.test.ts` | Tests based on the built-in provider's test file, adapted for BYOK behavior. |
| `package.json` | GitHub Packages npm configuration, peer dependencies, scripts. |
| `README.md` | Installation and configuration instructions. |

## 5. Provider ID and Model Mapping

- **Provider ID:** `cloudflare-ai-gateway-byok`
- **Model ID format:** `provider/model`, passed unchanged to `createUnified`.
- Cloudflare's Unified API determines the upstream provider from the model prefix, and BYOK injects the stored key on the gateway side.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@opencode-ai/cloudflare-ai-gateway-byok"],
  "providers": {
    "cloudflare-ai-gateway-byok": {
      "name": "Cloudflare AI Gateway (BYOK)",
      "package": "aisdk:ai-gateway-provider",
      "settings": {
        "accountId": "your-account-id",
        "gatewayId": "your-gateway-id",
        "apiKey": "your-api-token"
      },
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

Not supported in this release. The v2 Effect plugin API (`@opencode-ai/plugin/v2/effect`) exposed by `@opencode-ai/plugin@1.18.13` does not include an authentication-hook registration mechanism, so `/connect cloudflare-ai-gateway-byok` cannot be implemented against the public API surface. Use environment variables or `opencode.json` to configure credentials. `/connect` support will be revisited once the OpenCode plugin API exposes a v2 auth hook.

> **Tenant isolation:** Because the API token grants account-wide access, isolate tenants by using separate Cloudflare accounts or route through a Worker binding that enforces per-gateway authorization.

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
  "providers": {
    "cloudflare-ai-gateway-byok": {
      "package": "aisdk:ai-gateway-provider",
      "settings": {
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
4. Values from `opencode.json` (`accountId`, `gatewayId` or `gateway`, `apiKey`).

## 7. Implementation Details

### Plugin entry point

Use the OpenCode v2 Effect plugin API (`@opencode-ai/plugin/v2/effect`). The module exports `define` as a named export. `effect` returns `Effect.Effect<void, never, R>` and the plugin object has no top-level `name` field. The default export satisfies `Plugin`.

```ts
import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK } from "./cloudflare-ai-gateway-byok"

export default define({
  id: "@opencode-ai/cloudflare-ai-gateway-byok",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* CloudflareAIGatewayBYOK(ctx)
    }),
}) satisfies Plugin
```

### Runtime SDK hooks

Register `sdk` and `language` hooks through `ctx.aisdk.hook`. The hook callback receives an event with `model`, `package`, `options`, and a mutable `sdk` / `language` field. Assigning to `evt.sdk` or `evt.language` replaces the SDK-provided instance.

```ts
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import os from "os"
import { Effect } from "effect"

export const CloudflareAIGatewayBYOK = (ctx: PluginContext) =>
  Effect.gen(function* () {
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "ai-gateway-provider") return
        if (evt.options.baseURL) return

        const config = gatewayConfig(evt.options)
        if (!config) return

        const metadata = gatewayMetadata(evt.options)
        const { createAiGateway } = yield* Effect.promise(() =>
          import("ai-gateway-provider")
        ).pipe(Effect.orDie)

        evt.sdk = createAiGateway({
          accountId: config.accountId,
          gateway: config.gatewayId,
          apiKey: config.apiKey,
          options: gatewayOptions(evt.options, metadata),
        })
      })
    )

    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== "cloudflare-ai-gateway-byok") return

        const { createUnified } = yield* Effect.promise(() =>
          import("ai-gateway-provider/providers/unified")
        ).pipe(Effect.orDie)

        // BYOK: do not pass upstream provider API keys to createUnified
        const unified = createUnified({})
        evt.language = evt.sdk(unified(evt.model.api.id))
      })
    )
  })
```

### Auth and `/connect`

Authentication hooks (`AuthHook`) and the legacy `Hooks.auth` registration belong to the older `@opencode-ai/plugin` API, which returns `Promise<Hooks>`. The v2 Effect API (`@opencode-ai/plugin/v2/effect`) used in this plugin does not expose an auth-hook registration mechanism in `@opencode-ai/plugin@1.18.13`.

Therefore, `/connect cloudflare-ai-gateway-byok` is **not supported** in this release. Credentials must be supplied through environment variables or `opencode.json`. If OpenCode adds a v2 auth hook in a future release, this section can be implemented by registering the hook and merging the credentials into `evt.options` for the runtime hooks to consume.

> **Note on hook types:** `AuthHook` and `ProviderHook` are object types defined in the legacy `@opencode-ai/plugin` API, which returns `Promise<Hooks>`. In the v2 Effect API used here, `effect` returns `Effect.Effect<void, never, R>` and hooks are registered through `ctx.aisdk.hook`, `ctx.catalog.hook`, etc. `ProviderHook` is kept optional and is only relevant when dynamic model catalog discovery is needed;
it is not registered through the v2 runtime hooks.

### `ProviderHook` (optional model catalog)

```ts
import type { ProviderHook, ProviderHookContext, Model } from "@opencode-ai/plugin"

const byokProviderHook: ProviderHook = {
  id: "cloudflare-ai-gateway-byok",
  models: async (_provider, _ctx: ProviderHookContext): Promise<Record<string, Model>> => ({
    "openai/gpt-4o": { /* Model definition */ } as Model,
    "anthropic/claude-sonnet-4": { /* Model definition */ } as Model,
  }),
}
```

In practice, for the first release, require the user to declare the provider and model map in `opencode.json`. Add `ProviderHook` only when dynamic catalog discovery is required.

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

```json
{
  "name": "@opencode-ai/cloudflare-ai-gateway-byok",
  "version": "0.1.0",
  "description": "OpenCode plugin for Cloudflare AI Gateway BYOK",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "bun test"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.18.13 <2.0.0",
    "effect": ">=4.0.0-beta.83 <5.0.0"
  },
  "dependencies": {
    "ai-gateway-provider": "^2.3.1"
  },
  "devDependencies": {
    "@types/bun": "^1.2.0",
    "typescript": "^5.7.0"
  }
}
```

### Compatibility matrix

The following combinations are the supported/tested boundary for this plugin. Ranges follow semver; exact pins are committed in `bun.lockb`/`package-lock.json`/`yarn.lock` depending on the chosen package manager.

| Component | Minimum | Maximum | Reason |
| --- | --- | --- | --- |
| `@opencode-ai/plugin` | `1.18.13` | `<2.0.0` | Peer dependency; required for Effect plugin API (`define`, `ctx.aisdk.hook`) and (optionally) `ProviderHook` from the legacy API. Auth hooks are not available in the v2 Effect API as of `1.18.13`. |
| `effect` | `4.0.0-beta.83` | `<5.0.0` | Peer dependency matching `@opencode-ai/plugin@1.18.13` internal Effect version; plugin hooks are composed with `Effect.gen`. |
| `ai-gateway-provider` | `2.3.1` | `<3.0.0` | Runtime dependency; provides `createAiGateway` and `createUnified` used by the BYOK path. |
| `typescript` | `5.7.0` | `5.x` | Build dependency. |
| `@types/bun` | `1.2.0` | `latest` | Test runtime types. |
| OpenCode host | `1.18.13` | `<2.0.0` | Target host version matching the peer-dependency API surface. |

> **Verification note:** The exact cells marked with versions above are the declared compatibility window. Before publishing, run the test suite and a smoke test against each OpenCode host minor version inside the range (at least the latest patch of the minimum and current latest). Update this table if any combination fails.

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
- `@opencode-ai/plugin` and OpenCode host API surfaces may differ between versions; peer dependency ranges and the compatibility matrix must be chosen carefully.
- GitHub Packages requires authenticated install; documentation must include `.npmrc` setup.

## 12. References

- OpenCode built-in provider: `packages/core/src/plugin/provider/cloudflare-ai-gateway.ts`
- OpenCode built-in provider tests: `packages/core/test/plugin/provider-cloudflare-ai-gateway.test.ts`
- OpenCode plugins docs: `docs/opencode/plugins.mdx`
- OpenCode providers docs: `docs/opencode/providers.mdx`
- Cloudflare AI Gateway BYOK docs: <https://developers.cloudflare.com/ai-gateway/>
- Reference BYOK setup: `ericallenpaul/opencode-cloudflare-ai-gateway`
