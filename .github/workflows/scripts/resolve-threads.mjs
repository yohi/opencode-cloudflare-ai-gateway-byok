/**
 * ビルドプロンプト関数
 * レビューコメントと対象ファイルのコンテンツを結合してLLM用プロンプトを構築します。
 */
export function buildPrompt({ path: filePath, comments }, codeSnippet) {
  const conversation = comments
    .map((c) => `@${c.author?.login || "unknown"}: ${c.body}`)
    .join("\n\n");

  return `You are a code review assistant verifying if reported issues are resolved.

Target file: ${filePath}

Review Comment Thread:
${conversation}

Current File Content at HEAD:
\`\`\`
${codeSnippet}
\`\`\`

Evaluate if the issue raised in the review thread has been resolved/fixed in the Current File Content at HEAD.
Respond ONLY in JSON format matching this schema:
{
  "resolved": boolean,
  "reason": "Short concise explanation in Japanese"
}`;
}

/**
 * レビュースレッド評価および返信処理
 * 
 * 【セキュリティ設計上の重要事項】
 * レビュー本文やコード内容は外部からの信頼できない入力（Untrusted Input）を含み得るため、
 * LLM の判定結果（evaluation.resolved）のみを根拠としてスレッドの自動クローズ（resolveReviewThread）を行いません。
 * 
 * LLM の評価結果は参考情報・助言としてスレッドへの返信投稿にとどめ、
 * 物理的なスレッド解決はメンテナーによる確認・手動操作または明示的承認に限定します。
 */
export async function processReviewThread({ octokit, threadId, evaluation }) {
  const statusBadge = evaluation.resolved ? "✅ 解決済み（確認依頼）" : "⚠️ 未解決";
  const replyBody = `${statusBadge}\n\n**AI評価結果:** ${evaluation.reason}\n\n※セキュリティ設計により、LLMの判定のみによるスレッド自動クローズは実行されません。メンテナーによる確認後に手動でクローズを行ってください。`;

  // スレッドへの返信コメント投稿
  if (octokit && threadId) {
    await octokit.graphql(`
      mutation AddPullRequestReviewThreadReply($threadId: ID!, $body: String!) {
        addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
          comment {
            id
          }
        }
      }
    `, {
      threadId,
      body: replyBody,
    });
  }

  // NOTE: evaluation.resolved が true であっても resolveReviewThread Mutation は意図的に実行しません。
  return {
    postedReply: true,
    resolvedMutationExecuted: false,
    evaluation,
  };
}
