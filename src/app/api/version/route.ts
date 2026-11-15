// 公開している画面の版（Vercel が付ける git の番号）。画面が古いまま残っていないかを確かめるのに使う。
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "cache-control": "no-store" } },
  );
}
