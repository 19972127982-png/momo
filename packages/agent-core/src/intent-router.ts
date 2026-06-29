/**
 * 两级路由 · 一级：陪伴 vs 实用（W3 D6）
 *
 * 一级路由把用户输入分流到「陪伴模式」（CompanionAgent）或「实用模式」（工作族 Agent）。
 * W3 走「关键词优先」：命中文件/工具类意图 → utility（目前只有 FileAgent）；否则 companion。
 * LLM zero-shot 兜底留给桌面端在低置信度时可选挂载（这里只放确定性纯逻辑，便于单测）。
 *
 * 二级路由（族内选具体 Agent）W3 仅识别 FileAgent，W4 扩展。
 */
import type {
  AgentRunContext,
  IntentMode,
  Router,
  RouterResult,
} from "./types";

/**
 * 实用意图关键词。命中即倾向 utility。
 * 用「动作 + 对象」组合降低误伤（如「看看我桌面有什么」而非任意出现「文件」二字）。
 */
const FILE_INTENT_PATTERNS: readonly RegExp[] = [
  /(列|列出|列一下|看下|看一下|看看|有哪些|有什么|查看|展示).{0,8}(文件|文件夹|目录|桌面|desktop)/i,
  /(桌面|desktop|文件夹|目录).{0,8}(有什么|有哪些|里面|内容|列|看)/i,
  /(读取|读一下|读下|打开|查看).{0,6}(文件|txt|md|文档|内容)/,
  /(找一下|查找|搜索|搜一下).{0,8}(文件|文档)/,
  /(整理|归类|重命名|移动|删除).{0,6}(文件|文件夹|目录)/,
  /\b(list|read|open)\b.{0,12}\b(file|files|directory|folder|desktop)\b/i,
];

/** 强信号短语：单独出现也足够判 utility */
const FILE_STRONG_PHRASES: readonly RegExp[] = [
  /我的?桌面/,
  /桌面上/,
  /list\s+(my\s+)?desktop/i,
];

export interface KeywordIntentResult {
  mode: IntentMode;
  confidence: number;
  /** utility 时给出具体 Agent；companion 时省略 */
  agentName?: string;
  intent?: string;
}

/**
 * 纯关键词分类。返回 companion（默认）或 utility（命中文件意图）。
 * confidence：强短语 0.9 / 动作+对象 0.8 / 未命中（companion）0.6。
 */
export function classifyIntentByKeywords(
  userInput: string,
): KeywordIntentResult {
  const text = (userInput ?? "").trim();
  if (!text) return { mode: "companion", confidence: 0.6 };

  for (const re of FILE_STRONG_PHRASES) {
    if (re.test(text)) {
      return {
        mode: "utility",
        confidence: 0.9,
        agentName: "FileAgent",
        intent: "file",
      };
    }
  }
  for (const re of FILE_INTENT_PATTERNS) {
    if (re.test(text)) {
      return {
        mode: "utility",
        confidence: 0.8,
        agentName: "FileAgent",
        intent: "file",
      };
    }
  }
  return { mode: "companion", confidence: 0.6 };
}

/**
 * 关键词一级路由器。纯确定性，无 LLM 调用。
 * 桌面端可在 confidence 低时再挂 LLM zero-shot 兜底（W3 暂不需要，关键词足够跑通 demo）。
 */
export class KeywordIntentRouter implements Router {
  async route(
    userInput: string,
    _ctx: Pick<AgentRunContext, "workingMemory" | "signal">,
  ): Promise<RouterResult> {
    const r = classifyIntentByKeywords(userInput);
    return {
      mode: r.mode,
      confidence: r.confidence,
      agentName: r.agentName,
      intent: r.intent,
      scores: { keyword: r.confidence },
    };
  }
}
