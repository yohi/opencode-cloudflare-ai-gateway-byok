# @yohi/cloudflare-ai-gateway-byok

[OpenCode](https://opencode.ai/) 用のコミュニティプラグインです。[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) の Bring-Your-Own-Key (BYOK) モード経由で LLM リクエストをルーティングします。

> [!NOTE]
> このプロジェクトはコミュニティプロジェクトであり、OpenCode チームによって開発・公式サポートされているものではありません。

[English README](./README.md)

## 概要

このプラグインは OpenCode v2 Effect プラグインフックを登録し、プロバイダー ID が `cloudflare-ai-gateway-byok` であるモデルへの要求が発生した際、[`ai-gateway-provider`](https://www.npmjs.com/package/ai-gateway-provider) を内部で使用して SDK を構築します。プロバイダー（OpenAI、Anthropic など）の実際の API キーは Cloudflare AI Gateway 側に保存され、ローカルからは直接送信されません。プラグインは認証情報（Cloudflare トークン）と LLM リクエストデータ（モデル ID、プロンプトなど）を Cloudflare AI Gateway に送信し、Gateway がサーバー側で正しいアップストリームプロバイダーキーを挿入してリクエストを行います。

## 前提条件

- [AI Gateway](https://developers.cloudflare.com/ai-gateway/get-started/) が有効化された Cloudflare アカウント。
- **BYOK** モードで設定され、Cloudflare ダッシュボード上に少なくとも1つのアップストリームプロバイダーキーが保存されているゲートウェイ。
- **AI Gateway Run** 権限を持つ Cloudflare API トークン（アカウントスコープ。アカウント内のすべてのゲートウェイにアクセス可能）、または `CF_AIG_TOKEN`。
  AI Gateway Run 権限を持つトークンは、アカウント内のすべてのゲートウェイにアクセス可能です。テナントを分離する場合は、Cloudflare アカウントを分けるか、ゲートウェイ単位の認可を強制する Worker binding 経由でリクエストをルーティングしてください。[Cloudflare 認証ドキュメント](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)も参照してください。

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

モデル ID は `provider/model` 形式（例: `openai/gpt-4o` や `anthropic/claude-sonnet-4`）を使用します。ご利用の Cloudflare AI Gateway 設定でサポートされているモデル ID であれば動作します。

## BYOK の仕組み

「Bring Your Own Key (BYOK)」とは、このプラグインが OpenAI や Anthropic などの各プロバイダーのシークレットキーをローカルから送信しないことを意味します。これらのキーは Cloudflare AI Gateway ダッシュボード側であらかじめ設定しておきます。プラグインは認証情報と LLM リクエストデータを Cloudflare AI Gateway に送信し、Gateway がサーバー側で正しいアップストリームプロバイダーキーを挿入してリクエストを行います。

プロバイダーのシークレットキーは送信**されません**が、プラグインから Gateway へは次のデータが送信されます。

**認証情報（送信される）:**
- Cloudflare アカウント ID
- ゲートウェイ ID
- Cloudflare スコープのゲートウェイトークンまたは API トークン

**LLM リクエストデータ（送信される）:**
- モデル ID、プロンプト、ストリーミングレスポンスなど
- Gateway 経由でアップストリームプロバイダーへ転送されます

Cloudflare AI Gateway がサーバー側で正しいアップストリームプロバイダーキーを挿入してリクエストを行います。

### テナント分離

`CLOUDFLARE_API_TOKEN` と `CF_AIG_TOKEN`（AI Gateway Run 権限あり）はアカウントスコープで、アカウント内の複数ゲートウェイにアクセスできます。テナントを分離する場合は、Cloudflare アカウントを分けるか、ゲートウェイ単位の認可を強制する Worker binding 経由でリクエストをルーティングしてください。

## 非対応の機能・制限事項

- **`/connect cloudflare-ai-gateway-byok` は非対応**: OpenCode v2 Effect プラグイン API は対話型の認証フックを提供していないため、対話形式の `/connect` コマンドで認証情報を収集することはできません。
- **Workers AI は対象外**: 本プラグインは Cloudflare AI Gateway の BYOK / 統一エンドポイントを対象としており、単体の Workers AI API は対象外です。

## 技術仕様

詳細なアーキテクチャ、データフロー、コンポーネント構造、およびランタイムフックの実装仕様については [SPEC.md](./SPEC.md) を参照してください。

## ライセンス

MIT License。詳細は [LICENSE](./LICENSE) を参照してください。
