# Changelog

## [1.0.5](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/compare/v1.0.4...v1.0.5) (2026-08-12)


### 🐛 Bug Fixes

* **ci:** update oven-sh/setup-bun commit SHA ([#23](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/issues/23)) ([0829716](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/082971611b1a00b9548e7839e86c65fc1dcb40ef))
* LLMリクエストパラメータ（reasoning_effort, max_tokens）の正規化と不要プロパティ除去 ([#22](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/issues/22)) ([f4a9154](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/f4a9154ccd5765fada0672c27fd2eb7a815c5526))

## [1.0.4](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/compare/v1.0.3...v1.0.4) (2026-08-08)


### 🐛 Bug Fixes

* **ci:** use bun for setup and build in release workflow ([#18](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/issues/18)) ([b20d9be](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/b20d9beb923f4dcabf245b89b1c3e2e57c1c08f9))

## [1.0.3](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/compare/v1.0.2...v1.0.3) (2026-08-08)


### 🐛 Bug Fixes

* **utils:** set reasoning_effort to none when function tools are present ([90b734b](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/90b734b5caf3eb628dfdfacaeb0cf150eed7aa76))
* **utils:** set reasoning_effort to none when tools are present ([c082a61](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/c082a610f7fbf54c80293072ef72d8956e3e403c))


### ♻️ Refactors

* **utils:** normalize reasoningEffort to reasoning_effort before evaluating tools ([86a0c46](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/86a0c46940f50b1b393872e6490b646179605880))

## [1.0.2](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/compare/v1.0.1...v1.0.2) (2026-08-07)


### 🐛 Bug Fixes

* {env:VAR} 形式の環境変数プレースホルダー展開を修正 ([126b51f](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/126b51f6d937364519208bd9119459cd9d02093f))
* catchブロックの例外オブジェクト処理およびロギング形式のSonarルール対応 ([0439eb6](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/0439eb67b675d79bd673a17655d64e09dc1ade3d))
* custom fetchのRequestヘッダーの継承およびJSONパース例外時のログ出力対応 ([f2ac821](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/f2ac821af0d5bd7a73ca7e40b48e8b14d1265bb4))
* max_tokens パラメータ自動変換と 128 ツール制限および reasoning_effort のフォールバック対応 ([fa4b2da](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/fa4b2da06c6c3cf098db525bd1c7e84aaa269629))
* OpenCode のプロバイダーローダー仕様に合わせたモジュールエクスポートと設定解析を修正 ([25b4629](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/25b4629d5a58872eaddf40ea6ba64ae76f40c37a))
* OpenCode パラメータ互換性ガードレールおよびプロバイダー設定解析の修正 ([59f8ef6](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/59f8ef63d5eb6db7e45a0175c5ad637c1d62866b))
* 指摘事項（null/undefined ガード追加・デバッグログ削除・Requestオブジェクト対応等）の対応 ([2fae975](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/2fae97505a36110303bde1d5bc79a02f72df607e))


### ♻️ Refactors

* address review comments on fetch patching, type safety, and options fallback ([a82fd60](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/a82fd60f37fad2f20f70847fec60c321cd590792))
* resolve SonarCloud cognitive complexity and code smell warnings ([25c44b6](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/25c44b6a39ec2475f2e60408a4c078340e2a26b3))
* レビュー指摘事項に基づく記述の整理とパラメータ変換・URL判定の改善 ([ac840bd](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/ac840bd653eee0503d0d6db110c4fe6570bcf272))
* 共通ロジックの抽出による重複コード削減および各種指摘事項の修正 ([052e2c7](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/052e2c793191bd7649fb1cc4efcc9ba42566eeee))


### 📖 Documentation

* READMEのpackage設定例を@yohi/cloudflare-ai-gateway-byokに更新 ([01ad255](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/01ad255ca3ac3664103959ba557a855ed80e6112))

## [1.0.1](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/compare/v1.0.0...v1.0.1) (2026-08-07)


### 🐛 Bug Fixes

* release-pleaseの設定を追加しrefactorコミットをpatch bump対象に含める ([22d1aef](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/22d1aef9ee44edb97cde458c99675565452b7cd9))
* release-pleaseの設定を追加しrefactorコミットをpatch bump対象に含める ([b0ba103](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/b0ba103d886ffeb0d7f3314757bdf026bde59f6a))


### ♻️ Refactors

* gatewayOptionsの型をAiGatewayOptionsに修正し、不要な拡張型を削除 ([43046cf](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/43046cf38bdca85261cc09368eeeee097233e6a3))
* gatewayOptionsの型定義強化と型キャストの改善 ([63e1541](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/63e1541430934388cde1e476276ed82aa84b0f77))
* SDKイベントのパッケージ識別子を自パッケージ名に変更 ([0614c20](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/0614c203e41b87e3509455787968fe6d52beb010))
* SDKイベントのパッケージ識別子を自パッケージ名に変更 ([f27a4d8](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/f27a4d8eb87d2d1e054a78aad9ceca4c53693cc2))


### 📖 Documentation

* add AGENTS.md and SPEC.md, update READMEs, fix scope and plugin key ([40f47e7](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/40f47e7f5c68ac3c086887bdce2578da377b2979))
* BYOKの仕組みでLLMリクエストデータの送信を明記 ([6a4c606](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/6a4c606c316a12e2e71c5c6eb960a80443378b8f))
* 日本語のREADME.ja.mdの追加とリンクを設定 ([aea8dae](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/aea8daee9c9886f3f7ed6837a4bd642bc5657742))
* 設定例のキー名修正およびトークンスコープ仕様の記述更新 ([c998205](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/c99820559dadebda70ff90507f81169a77e7d69f))

## 1.0.0 (2026-08-06)


### Features

* Cloudflare AI Gateway BYOKプラグインのコア実装を追加 ([8211d21](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/8211d21d669fe7ed03d6874f1c1c4a353e0cd84e))
* Cloudflare AI Gateway BYOKプラグインのコア実装を追加 ([d90ff68](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/d90ff68d04bf3593d15124d49dc624b9d08bb927))


### Bug Fixes

* **ci:** SonarCloudの警告に対応するため npm ci に --ignore-scripts を追加 ([c02511f](https://github.com/yohi/opencode-cloudflare-ai-gateway-byok/commit/c02511fb4574fd0fa7c760616fc42d249e4b52c3))
