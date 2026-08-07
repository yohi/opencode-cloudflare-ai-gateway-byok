# @yohi/cloudflare-ai-gateway-byok

A community plugin for OpenCode that routes LLM requests through Cloudflare AI Gateway in BYOK mode.

## Tech Stack

- Package manager: `bun`
- Build: `tsc` (standard TypeScript config)
- Test: `bun test`
- Type check: `tsc --noEmit`

## Quick Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run build` | Compile TypeScript to `dist/` |
| `bun run typecheck` | Type-check production code |
| `bun run typecheck:test` | Type-check test code |
| `bun test` | Run test suite |

## Project Structure

- `src/` – Plugin source (Effect-based OpenCode v2 plugin)
  - `cloudflare-ai-gateway-byok.ts` – Main Effect plugin definition
  - `env.ts` – Credential resolution helpers
  - `index.ts` – Package entry point
- `test/` – Test suite (`bun` test runner, no additional framework)
- `dist/` – Compiled output (published to GitHub Packages)

## Notes

- This is a TypeScript ESM package targeting OpenCode v2's Effect plugin API.
- Do not add OpenCode as a runtime dependency; it is a `peerDependency`.
