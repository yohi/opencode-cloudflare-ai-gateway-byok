# E2E テスト大幅拡充 設計書

**日付**: 2026-08-13
**対象プロジェクト**: @yohi/cloudflare-ai-gateway-byok
**設計フェーズ**: Brainstorming 完了 → 実装計画作成前

## 1. 目的

OpenCode v2 Effect プラグインとして、本プラグインが Cloudflare AI Gateway BYOK エンドポイントへ正しくリクエストを送信し、認証・設定・モデル変換・パラメータ正規化が期待通り動作することを、実アカウントや実トークン、課金を発生させることなく検証する。

## 2. 背景

- 現在の `test/` ディレクトリには単体テストのみが存在し、プラグイン全体を通した End-to-End 検証が不足している。
- 最近のコミットでは `reasoning_effort` / `max_tokens` の正規化、不要プロパティ除去、プロバイダーローダー互換性の修正など、リクエスト生成パス全体に関わる変更が入っている。
- これらの振る舞いは、HTTP クライアントや外部 SDK を組み合わせた擬似 E2E テストでこそ効果的に担保できる。

## 3. テスト戦略

### 3.1 アプローチ

- **擬似 E2E（モックベース）**: 実際の Cloudflare AI Gateway ではなく、テスト専用の軽量 HTTP モックサーバーを立てて検証する。
- **テストランナー**: 既存の `bun test` を維持する。
- **HTTP 層の差し替え**: 新設する `CLOUDFLARE_AIG_BASE_URL` 環境変数で、Gateway エンドポイントをモックサーバーに向ける。これにより、実アカウントへの通信を一切発生させずに、実際のリクエストパス・ヘッダー・ボディを検証できる。

### 3.2 モックサーバー仕様

| 項目 | 内容 |
| --- | --- |
| 起動タイミング | テストスイートの `beforeAll` で起動、`afterAll` で停止 |
| リッスンアドレス | `127.0.0.1`、動的に空いているポートを選択 |
| エンドポイント | `POST /accounts/:accountId/ai/gateway/:gatewayId/:provider` |
| 認証ヘッダー検証 | `Authorization: Bearer {token}` の存在と値を検証 |
| リクエストボディ | JSON をパースし、メモリに保持してテストからアサート可能にする |
| レスポンス | リクエストされた `provider`（`openai` / `anthropic` など）に応じた簡易な成功応答を返す |
| エラー応答 | 任意の HTTP ステータスとボディを返せるようにし、後続フェーズのエラーハンドリングテストを見越す |

### 3.3 テスト時の環境変数

```bash
CLOUDFLARE_ACCOUNT_ID=test-account
CLOUDFLARE_GATEWAY_ID=test-gateway
CLOUDFLARE_API_TOKEN=test-token
CLOUDFLARE_AIG_BASE_URL=http://127.0.0.1:{mock-port}
```

## 4. 第一フェーズでカバーするシナリオ

### 4.1 基本フロー

- プラグインが正常に初期化される。
- モック Gateway へ正しい `accountId`、`gatewayId`、`provider`、`model`、メッセージを含むリクエストを送信する。
- モック Gateway からの応答を正しく受け取り、OpenCode プラグイン API の期待する形式で返す。

### 4.2 認証フォールバック

- `CLOUDFLARE_API_TOKEN` が存在する場合、それが `Authorization` ヘッダーに使われる。
- `CLOUDFLARE_API_TOKEN` が未設定で `CF_AIG_TOKEN` が存在する場合、`CF_AIG_TOKEN` が使われる。
- 両方未設定で `opencode.json` の `apiKey` が存在する場合、その値が使われる。
- それぞれの状態で `Authorization: Bearer {token}` の値が期待通りになることを検証する。

### 4.3 環境変数解決

- `opencode.json` の設定値として `{env:CLOUDFLARE_ACCOUNT_ID}` や `{env:CLOUDFLARE_GATEWAY_ID}` などのプレースホルダーが指定された場合、実行時に環境変数から展開され、モック Gateway へ正しいパスでリクエストが届くことを検証する。

### 4.4 プロバイダー別リクエスト

- `openai/gpt-4o`、`anthropic/claude-sonnet-4` などのモデル ID に応じて、モック Gateway へのパスとリクエストボディの構造が正しく生成されることを検証する。
- 各プロバイダーで期待される最小限のフィールドが含まれることを確認する。

### 4.5 パラメータ正規化

- `reasoningEffort` が `reasoning_effort` に正規化される。
- tools 存在時に `reasoning_effort` が適切に調整される。
- `max_tokens` などの追加パラメータが Gateway 送信前に正しく処理される。
- これらはモック Gateway に届くリクエストボディをアサートすることで検証する。

## 5. テストファイル構成（案）

```text
test/
├── e2e/
│   ├── setup.ts              # モックサーバー起動・停止、環境変数セットアップ
│   ├── mock-gateway.ts       # モック Gateway サーバー実装
│   ├── e2e.test.ts           # 主要シナリオの統合テスト
│   ├── auth-fallback.test.ts # 認証フォールバック専用テスト
│   ├── env-resolution.test.ts# 環境変数解決専用テスト
│   ├── provider-routing.test.ts # プロバイダー別リクエスト検証
│   └── parameter-normalization.test.ts # パラメータ正規化検証
└── unit/                     # 既存単体テスト（変更しない）
```

## 6. 実装時の確認事項

- プラグイン側で Cloudflare AI Gateway のベース URL を `CLOUDFLARE_AIG_BASE_URL` 環境変数で上書きできるよう、設定解決ロジックを追加する必要がある。
- 既存の `src/env.ts` および `src/cloudflare-ai-gateway-byok.ts` の変更範囲を確認し、テストを通すための最小限の改修とする。
- ストリーミング応答の扱いは、実装を確認した上で第一フェーズに含めるか、次フェーズに回すかを判断する。

## 7. 後続フェーズ（第二フェーズ以降）

- **エラーハンドリングテスト**: モック Gateway からの 4xx/5xx を発生させ、OpenCode への伝搬を検証する。
- **設定バリデーションテスト**: `accountId` や `gatewayId` 未設定時に初期化が失敗することを検証する。
- **ストリーミングテスト**: SSE / chunked 応答を正しくパイプできることを検証する。
- **追加プロバイダー**: その他の upstream provider 形式への対応を検証する。

## 8. 成功基準

- `bun test` で全 E2E テストが通る。
- CI ワークフロー上でも追加テストが正常に実行される。
- 実アカウント / 実トークン / 課金なしで、主要なリクエスト生成パスが網羅的に検証できる。

## 9. 設計承認状況

- Brainstorming フェーズでユーザー承認済み。
- 次ステップ: `writing-plans` スキルによる実装計画作成。
