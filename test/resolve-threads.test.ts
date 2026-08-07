import { describe, expect, test } from "bun:test";
import { buildPrompt, processReviewThread } from "../.github/workflows/scripts/resolve-threads.mjs";

describe("resolve-threads.mjs", () => {
  test("buildPrompt 構文およびコンテキスト挿入のテスト", () => {
    const comments = [
      { author: { login: "alice" }, body: "タイポがあります。" },
      { author: { login: "bob" }, body: "修正しました。" },
    ];
    const codeSnippet = "const foo = 'bar';";
    const prompt = buildPrompt({ path: "src/index.ts", comments }, codeSnippet);

    expect(prompt).toContain("Target file: src/index.ts");
    expect(prompt).toContain("@alice: タイポがあります。");
    expect(prompt).toContain("@bob: 修正しました。");
    expect(prompt).toContain("const foo = 'bar';");
    expect(prompt).toContain('"resolved": boolean');
  });

  test("processReviewThread が LLM の判定によらず自動クローズを行わず返信コメントを投稿すること", async () => {
    let graphqlCalled = false;
    let queryUsed = "";

    const mockOctokit = {
      graphql: async (query: string, variables: any) => {
        graphqlCalled = true;
        queryUsed = query;
        return { addPullRequestReviewThreadReply: { comment: { id: "123" } } };
      },
    };

    const evaluation = { resolved: true, reason: "問題は修正されています。" };
    const result = await processReviewThread({
      octokit: mockOctokit as any,
      threadId: "PRRT_kwDO12345",
      evaluation,
    });

    expect(graphqlCalled).toBe(true);
    expect(queryUsed).toContain("addPullRequestReviewThreadReply");
    expect(queryUsed).not.toContain("resolveReviewThread");
    expect(result.resolvedMutationExecuted).toBe(false);
    expect(result.postedReply).toBe(true);
  });
});
