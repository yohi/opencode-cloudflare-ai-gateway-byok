# @yohi/cloudflare-ai-gateway-byok

[OpenCode](https://opencode.ai/) 用のコミュニティプラグインです。[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) の Bring-Your-Own-Key (BYOK) モード経由で LLM リクエストをルーティングします。

> [!NOTE]
> このプロジェクトはコミュニティプロジェクトであり、OpenCode チームによって開発・公式サポートされているものではありません。

[English README](./README.md)

## 概要

このプラグインは OpenCode v2 Effect プラグインフックを登録し、プロバイダー ID が `cloudflare-ai-gateway-byok` であるモデルへの要求が発生した際、デフォルトの AI SDK プロバイダーを `ai-gateway-provider` に置換します。プロバイダー（OpenAI、Anthropic など）の実際の API キーは Cloudflare AI Gateway 側に保存されるため、ローカルマシンから外部に送信されるのは Cloudflare ゲートウェイトークンのみとなります。

## 前提条件

- [AI Gateway](https://developers.cloudflare.com/ai-gateway/get-started/) が有効化された Cloudflare アカウント。
- **BYOK** モードで設定され、Cloudflare ダッシュボード上に少なくとも1つのアップストリームプロバイダーキーが保存されているゲートウェイ。
- **AI Gateway Run** 権限を持つ Cloudflare API トークン（アカウントスコープ。アカウント内のすべてのゲートウェイにアクセス可能）、またはゲートウェイスコープの `CF_AIG_TOKEN`。  
  `CF_AIG_TOKEN` は、それが発行された特定のゲートウェイのみに制限されます。BYOK が有効なゲートウェイに対して最小権限でアクセスしたい場合は、単一のゲートウェイにのみ接続すればよい場合に `CF_AIG_TOKEN` を使用し、それ以外の場合はアカウントスコープの API トークンを使用してください。

## パッケージレジストリの設定

このパッケージは GitHub Packages の `@yohi` スコープ下に公開されています。  
プロジェクトのルート（または実行するコマンドの隣）にある `.npmrc` に以下を追加してください。

```ini
@yohi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

`NODE_AUTH_TOKEN` には、`read:packages` スコープを持つ GitHub 個人用アクセストークン（PAT）を設定します。

## インストール

```bash
bun add @yohi/cloudflare-ai-gateway-byok
```

## 設定

プラグインはまず環境変数から認証情報を読み込み、設定されていない場合に `opencode.json` 内のオプション設定にフォールバックします。

### 環境変数

| 変数名 | 目的 |
| ----------------------- | -------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID |
| `CLOUDFLARE_GATEWAY_ID` | AI Gateway 名 / ID |
| `CLOUDFLARE_API_TOKEN`  | 優先して使用される Cloudflare API トークン |
| `CF_AIG_TOKEN`          | `CLOUDFLARE_API_TOKEN` が設定されていない場合に使用されるフォールバックゲートウェイトークン |

トークンの優先順位:

1. 環境変数の `CLOUDFLARE_API_TOKEN`
2. 環境変数の `CF_AIG_TOKEN`
3. `opencode.json` のプラグインオプションで指定された `apiKey` の値

※環境変数の設定は常に `opencode.json` の値より優先されます。

### OpenCode 設定例

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

モデル ID は `ai-gateway-provider` の統一形式（例: `openai/gpt-4o` や `anthropic/claude-sonnet-4`）に従います。ご利用の Cloudflare AI Gateway 設定でサポートされているモデル ID であれば動作します。

## BYOK の仕組み

「Bring Your Own Key (BYOK)」とは、このプラグインが OpenAI や Anthropic などの各プロバイダーのシークレットキーを OpenCode に送信しないことを意味します。これらのキーは Cloudflare AI Gateway ダッシュボード側であらかじめ設定しておきます。プラグインが送信するのは以下の情報のみです。

- Cloudflare アカウント ID
- ゲートウェイ ID
- Cloudflare スコープのゲートウェイトークンまたは API トークン

Cloudflare AI Gateway がサーバー側で正しいアップストリームプロバイダーキーを挿入してリクエストを行います。

### テナント分離

`CLOUDFLARE_API_TOKEN` はアカウントスコープで、アカウント内の複数ゲートウェイにアクセスできます。テナントを分離する場合は、Cloudflare アカウントを分けるか、ゲートウェイ単位の認可を強制する Worker binding 経由でリクエストをルーティングしてください。単一ゲートウェイに限定する場合は `CF_AIG_TOKEN` を使用します。

## 非対応の機能・制限事項

- **`/connect cloudflare-ai-gateway-byok` は非対応**: OpenCode v2 Effect プラグイン API は対話型の認証フックを提供していないため、対話形式の `/connect` コマンドで認証情報を収集することはできません。
- **Workers AI は対象外**: 本プラグインは Cloudflare AI Gateway の BYOK / 統一エンドポイントを対象としており、単体の Workers AI API は対象外です。

## 技術仕様

詳細なアーキテクチャ、データフロー、コンポーネント構造、およびランタイムフックの実装仕様については [SPEC.md](./SPEC.md) を参照してください。

## ライセンス

MIT License。詳細は [LICENSE](./LICENSE) を参照してください。
