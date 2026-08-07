# @yohi/cloudflare-ai-gateway-byok

A community plugin for [OpenCode](https://opencode.ai/) that routes LLM requests
through a [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
using the gateway's Bring-Your-Own-Key (BYOK) mode.

[日本語の README](./README.ja.md)


> This is a community project and is **not built or officially supported** by the
> OpenCode team.

## What it does

The plugin registers an OpenCode v2 Effect plugin hook that intercepts SDK
initialization for the `cloudflare-ai-gateway-byok` provider and builds an
[`ai-gateway-provider`](https://www.npmjs.com/package/ai-gateway-provider)
SDK internally. The actual upstream provider API keys (OpenAI, Anthropic, etc.)
are stored and managed in Cloudflare AI Gateway, so they are never sent from
this machine. The plugin sends authentication (Cloudflare token) and LLM request
data (model ID, prompts, etc.) to the Gateway, which then injects the correct
upstream provider key on the server side.

## Prerequisites

- A Cloudflare account with [AI Gateway](https://developers.cloudflare.com/ai-gateway/get-started/)
  enabled.
- A gateway configured in **BYOK** mode with at least one upstream provider key
  saved in the Cloudflare dashboard.
- A Cloudflare API token with the **AI Gateway Run** permission (account-scoped,
  can access all gateways within the account), or `CF_AIG_TOKEN`.
  A token with the AI Gateway Run permission can access all gateways within the
  account. For tenant isolation, use separate Cloudflare accounts or route
  requests through a Worker binding that enforces per-gateway authorization.
  See the [Cloudflare API token documentation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## Package registry setup

This package is published to GitHub Packages under the `@yohi` scope.
Add the following to the `.npmrc` in your project root (or next to the command
you run):

```ini
@yohi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Set `NODE_AUTH_TOKEN` to a GitHub personal access token with the `read:packages`
scope.

## Installation

```bash
bun add @yohi/cloudflare-ai-gateway-byok
```

## Configuration

The plugin reads credentials from environment variables first, then falls back
to optional plugin options in `opencode.json`.

### Environment variables

| Variable                | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID.                             |
| `CLOUDFLARE_GATEWAY_ID` | AI Gateway name / ID.                              |
| `CLOUDFLARE_API_TOKEN`  | Primary Cloudflare API token (preferred).          |
| `CF_AIG_TOKEN`          | Fallback gateway token used when `CLOUDFLARE_API_TOKEN` is not set. |

Token precedence:

1. `CLOUDFLARE_API_TOKEN` from the environment.
2. `CF_AIG_TOKEN` from the environment.
3. The `apiKey` value from `opencode.json` plugin options.

Environment variables always take precedence over values in `opencode.json`.

### OpenCode example

```json
{
  "plugins": [
    "@yohi/cloudflare-ai-gateway-byok"
  ],
  "providers": {
    "cloudflare-ai-gateway-byok": {
      "package": "@yohi/cloudflare-ai-gateway-byok",
      "settings": {
        "accountId": "{env:CLOUDFLARE_ACCOUNT_ID}",
        "gatewayId": "{env:CLOUDFLARE_GATEWAY_ID}",
        "apiKey": "{env:CLOUDFLARE_API_TOKEN}"
      },
      "models": {
        "openai/gpt-4o": {
          "enabled": true
        },
        "anthropic/claude-sonnet-4": {
          "enabled": true
        }
      }
    }
  }
}
```

Model IDs use the unified format `provider/model`, for example
`openai/gpt-4o` or `anthropic/claude-sonnet-4`. Any model ID supported by your
Cloudflare AI Gateway configuration should work.

## BYOK behavior

"Bring your own key" means this plugin never sends an OpenAI, Anthropic, or
other provider secret from this machine. Those keys are configured once in the
Cloudflare AI Gateway dashboard. The plugin sends authentication and LLM request
data to Cloudflare AI Gateway, which then injects the correct upstream provider
key on the server side.

Provider secrets are **not** sent, but the following data is transmitted from the
plugin to the Gateway:

**Authentication (sent):**
- Your Cloudflare account ID.
- Your gateway ID.
- A Cloudflare-scoped gateway or API token.

**LLM request data (sent):**
- Model IDs, prompts, streaming responses, etc.
- Forwarded to the upstream provider via the Gateway.

Cloudflare AI Gateway then injects the correct upstream provider key on the
server side.

### Tenant isolation

`CLOUDFLARE_API_TOKEN` and `CF_AIG_TOKEN` (with AI Gateway Run permission) are
account-scoped and can access gateways across the account. For tenant isolation,
use separate Cloudflare accounts or route requests through a Worker binding that
enforces per-gateway authorization.

## What is not supported

- **`/connect cloudflare-ai-gateway-byok`** is not supported. The OpenCode v2
  Effect plugin API does not expose authentication hooks, so the interactive
  `/connect` command cannot collect credentials for this provider.
- **Workers AI** is out of scope. This plugin targets Cloudflare AI Gateway's
  BYOK/unified endpoint, not the standalone Workers AI API.

## Technical specification

For in-depth architecture details, data flow, component breakdown, and runtime hook implementation, see [SPEC.md](./SPEC.md).

## License

MIT License. See [LICENSE](./LICENSE) for details.
