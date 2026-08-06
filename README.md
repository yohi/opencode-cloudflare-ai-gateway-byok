# @yohi/cloudflare-ai-gateway-byok

A community plugin for [OpenCode](https://opencode.ai/) that routes LLM requests
through a [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
using the gateway's Bring-Your-Own-Key (BYOK) mode.

[日本語の README](./README.ja.md)


> This is a community project and is **not built or officially supported** by the
> OpenCode team.

## What it does

The plugin registers an OpenCode v2 Effect plugin hook that replaces the default
AI SDK provider with `ai-gateway-provider` whenever OpenCode wants to talk to a
model whose provider ID is `cloudflare-ai-gateway-byok`. The actual upstream
provider API keys (OpenAI, Anthropic, etc.) are stored in Cloudflare AI Gateway,
so only the gateway token leaves this machine.

## Prerequisites

- A Cloudflare account with [AI Gateway](https://developers.cloudflare.com/ai-gateway/get-started/)
  enabled.
- A gateway configured in **BYOK** mode with at least one upstream provider key
  saved in the Cloudflare dashboard.
- A Cloudflare API token with the **AI Gateway Run** permission (account-scoped,
  can access all gateways within the account), or a gateway-scoped `CF_AIG_TOKEN`.
  The `CF_AIG_TOKEN` is limited to the specific gateway it was issued for. For the
  least-privilege access to BYOK-enabled gateways, use `CF_AIG_TOKEN` when you only
  need to reach a single gateway, otherwise use the account-scoped API token.

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
  "plugin": [
    "@yohi/cloudflare-ai-gateway-byok"
  ],
  "providers": {
    "cloudflare-ai-gateway-byok": {
      "package": "ai-gateway-provider",
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

Model IDs follow the `ai-gateway-provider` unified convention, for example
`openai/gpt-4o` or `anthropic/claude-sonnet-4`. Any model ID supported by your
Cloudflare AI Gateway configuration should work.

## BYOK behavior

"Bring your own key" means this plugin never sends an OpenAI, Anthropic, or
other provider secret to OpenCode. Those keys are configured once in the
Cloudflare AI Gateway dashboard. The plugin only sends:

- Your Cloudflare account ID.
- Your gateway ID.
- A Cloudflare-scoped gateway or API token.

Cloudflare AI Gateway then injects the correct upstream provider key on the
server side.

### Tenant isolation

`CLOUDFLARE_API_TOKEN` is account-scoped and can access gateways across the
account. For tenant isolation, use separate Cloudflare accounts or route
requests through a Worker binding that enforces per-gateway authorization. Use
`CF_AIG_TOKEN` when access should be limited to one gateway.

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
