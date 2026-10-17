import { z } from "zod";
import {
  api,
  HttpError,
  jsonBody,
  owner,
  quota,
  sameOrigin,
} from "@/lib/server";
import { openAICompatible, tavily } from "@/lib/providers";
export const runtime = "nodejs";
export const POST = api(async (req) => {
  sameOrigin(req);
  const user = await owner(req);
  if (
    !process.env.AI_API_KEY ||
    !process.env.AI_MODEL ||
    !process.env.TAVILY_API_KEY
  )
    throw new HttpError(503, "AI 服务未配置；手工编辑仍可使用");
  await quota(user, "ai", 20);
  const { keyword, context } = z
    .object({
      keyword: z.string().trim().min(1).max(160),
      context: z.string().max(500),
    })
    .parse(await jsonBody(req, 8192));
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(30000)]);
  try {
    const { sources, images } = await tavily.search(keyword, signal);
    if (!sources.length)
      throw new HttpError(422, "资料不足，未找到可引用的搜索结果");
    const draft = await openAICompatible.summarize(
      keyword,
      context,
      sources,
      signal,
    );
    return Response.json({
      ...draft,
      images,
      searchedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (signal.aborted)
      throw new HttpError(504, "检索已取消或超时，已有内容已保留");
    throw e;
  }
});
