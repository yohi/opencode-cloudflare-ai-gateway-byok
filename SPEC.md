# Cloudflare AI Gateway BYOK Plugin Specification

## 1. Overview & Purpose

`@yohi/cloudflare-ai-gateway-byok` is an independent OpenCode community plugin that routes LLM requests through Cloudflare AI Gateway using **Bring Your Own Key (BYOK)** semantics.

In standard mode, clients must send both Cloudflare authentication headers (`cf-aig-authorization`) and upstream provider keys (e.g. OpenAI/Anthropic API keys). In **BYOK mode**, upstream provider API keys are stored and managed directly in Cloudflare AI Gateway. The client only transmits the Cloudflare Gateway API token, eliminating client-side storage or transmission of upstream LLM credentials.

### Key Characteristics

- **Provider ID:** `cloudflare-ai-gateway-byok`
- **Model ID Format:** `provider/model` (e.g., `openai/gpt-4o`, `anthropic/claude-sonnet-4`)
- **Authentication:** Cloudflare Gateway API Token (`CLOUDFLARE_API_TOKEN` / `CF_AIG_TOKEN`) only
- **Upstream Key Ingestion:** None on client; `createUnified({})` is invoked without upstream API keys.

---

## 2. Architecture & Data Flow

```text
OpenCode (opencode.json / Environment Variables)
  │
  ▼
Provider ID: cloudflare-ai-gateway-byok
  │
  ▼
opencode-cloudflare-ai-gateway-byok plugin
  │
  ├─ ctx.aisdk.sdk Hook
  │    └─ createAiGateway({ accountId, gateway, apiKey, options })
  │
  └─ ctx.aisdk.language Hook
       └─ createUnified({})  (Empty object; no upstream keys)
  │
  ▼
Cloudflare AI Gateway (BYOK Endpoints)
  │ (Server-side key injection)
  ▼
Upstream LLM Providers (OpenAI, Anthropic, Google, etc.)
```

### Out-of-Scope: Workers AI

Cloudflare Workers AI uses Cloudflare's internal inference infrastructure and a distinct authentication model (Cloudflare API Token vs. Gateway Token). Workers AI is out of scope for the BYOK gateway provider flow.

---

## 3. Component Structure

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entrypoint; defines the plugin using `@opencode-ai/plugin/v2/effect`. |
| `src/cloudflare-ai-gateway-byok.ts` | Core provider logic; registers runtime `sdk` and `language` hooks. |
| `src/env.ts` | Credentials and options resolution (`gatewayConfig`, `gatewayMetadata`, `gatewayOptions`, `stringOption`). |
| `test/cloudflare-ai-gateway-byok.test.ts` | Unit tests covering credential resolution, hook behavior, and BYOK logic. |
| `package.json` | Package configuration, dependencies, and publishing metadata. |
| `README.md` / `README.ja.md` | User documentation and setup guides. |
| `SPEC.md` | Technical specification document. |

---

## 4. Configuration & Credentials Resolution

### Precedence Hierarchy

Credentials and settings are resolved in the following strict order:

1. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_GATEWAY_ID` environment variables.
2. `CLOUDFLARE_API_TOKEN` environment variable.
3. `CF_AIG_TOKEN` environment variable (fallback if `CLOUDFLARE_API_TOKEN` is unset).
4. `opencode.json` plugin settings (`accountId`, `gatewayId` or `gateway`, `apiKey`).

### Configuration Example (`opencode.json`)

```json
{
  "plugin": [
    "@yohi/cloudflare-ai-gateway-byok"
  ],
  "providers": {
    "cloudflare-ai-gateway-byok": {
      "package": "ai-gateway-provider",
      "settings": {
        "accountId": "your-account-id",
        "gatewayId": "your-gateway-id",
        "apiKey": "your-api-token"
      },
      "models": {
        "openai/gpt-4o": { "enabled": true },
        "anthropic/claude-sonnet-4": { "enabled": true }
      }
    }
  }
}
```

### Limitations

- **/connect Command:** `/connect cloudflare-ai-gateway-byok` is unsupported in this release because OpenCode's v2 Effect plugin API (`@opencode-ai/plugin/v2/effect`) does not expose an interactive authentication hook registration mechanism. Credentials must be supplied via environment variables or `opencode.json`.
- **Tenant isolation:** `CLOUDFLARE_API_TOKEN` is account-scoped. Isolate tenants with separate Cloudflare accounts or a Worker binding that enforces per-gateway authorization. Use `CF_AIG_TOKEN` for a gateway-scoped token.

---

## 5. Technical Implementation Details

### Plugin Entrypoint (`src/index.ts`)

Uses `@opencode-ai/plugin/v2/effect`'s `define` helper:

```ts
import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import { CloudflareAIGatewayBYOK } from "./cloudflare-ai-gateway-byok.js"

export default define({
  id: "@yohi/cloudflare-ai-gateway-byok",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* CloudflareAIGatewayBYOK(ctx)
    }),
}) satisfies Plugin
```

### Runtime Hooks (`src/cloudflare-ai-gateway-byok.ts`)

1. **SDK Hook (`ctx.aisdk.sdk`)**:
   - Matches when `evt.package === "ai-gateway-provider"` and `evt.options.baseURL` is not set.
   - Resolves credentials via `gatewayConfig(evt.options)`.
   - Dynamically imports `ai-gateway-provider` and initializes `createAiGateway`.
   - Sets `User-Agent` header to `opencode cloudflare-ai-gateway-byok (${os.platform()} ${os.release()}; ${os.arch()})`.

2. **Language Hook (`ctx.aisdk.language`)**:
   - Matches when `evt.model.providerID === "cloudflare-ai-gateway-byok"` and `evt.sdk` is present.
   - Dynamically imports `ai-gateway-provider/providers/unified`.
   - Calls `createUnified({})` with an empty object (BYOK requirement).
   - Assigns `evt.language = evt.sdk(unified(evt.model.api.id))`.

### Deferred model catalog

The first release requires the provider and model map to be declared in
`opencode.json`. A legacy `ProviderHook` is intentionally not registered with
the v2 Effect runtime hooks. Add dynamic catalog discovery only when the
gateway's model catalog is required by users.

### Compatibility path

The BYOK path uses `createUnified({})` so no upstream provider key is supplied
by the client. Treat this as the compatibility path until a supported direct
REST integration is available in `ai-gateway-provider`; any future migration
must preserve the empty-key BYOK invariant and update this specification.

---

## 6. Error Handling & Guard Conditions

| Condition | Behavior |
| --- | --- |
| Missing account ID, gateway ID, or API token | Returns `undefined` from `gatewayConfig`; leaves `evt.sdk` unset so OpenCode can fall back. |
| `baseURL` set in `evt.options` | Skips gateway initialization to respect custom endpoints. |
| Non-`ai-gateway-provider` package | SDK hook returns early without modifying `evt.sdk`. |
| Non-`cloudflare-ai-gateway-byok` provider ID | Language hook returns early without modifying `evt.language`. |
| Dynamic import failure | Fails fast via `Effect.orDie`. |

---

## 7. Compatibility Matrix

| Dependency / Component | Supported Window | Notes |
| --- | --- | --- |
| `@opencode-ai/plugin` | `>=1.18.13 <2.0.0` | Peer dependency for v2 Effect plugin API. |
| `effect` | `>=4.0.0-beta.83 <5.0.0` | Peer dependency matching OpenCode host Effect version. |
| `ai-gateway-provider` | `^3.1.2` | Runtime dependency delivering `createAiGateway` and `createUnified`. |
| `typescript` | `^5.7.0` | Build dependency. |
| `@types/bun` | `^1.2.0` | Test runtime types. |

The OpenCode host must provide the v2 Effect plugin API compatible with
`@opencode-ai/plugin` 1.18.13 through the supported 1.x range. Before
publishing, run the test suite and a smoke test against the minimum supported
host patch and the current latest host patch. Update this matrix when a
combination fails.

## 8. Test Contract

The test suite must preserve these behaviors:

1. `createUnified` receives an empty object.
2. `createAiGateway` receives the account, gateway, and gateway token.
3. Environment variables take precedence over configuration values.
4. `CF_AIG_TOKEN` is used when `CLOUDFLARE_API_TOKEN` is absent.
5. Model IDs pass through unchanged.
6. Missing credentials leave the SDK unset.
7. An existing `baseURL` leaves the SDK unchanged.
8. Non-`ai-gateway-provider` packages are ignored.

## 9. References

- OpenCode built-in provider: `oss/opencode/packages/core/src/plugin/provider/cloudflare-ai-gateway.ts`
- OpenCode built-in provider tests: `oss/opencode/packages/core/test/plugin/provider-cloudflare-ai-gateway.test.ts`
- OpenCode plugin docs: `docs/opencode/plugins.mdx`
- OpenCode provider docs: `docs/opencode/providers.mdx`
- Cloudflare AI Gateway: <https://developers.cloudflare.com/ai-gateway/>
