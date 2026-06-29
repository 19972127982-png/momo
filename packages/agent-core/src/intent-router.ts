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
  /\b(list|read|open)\b.{0,12}\b(file|files|directory|folder|desktop)\b/i,
  // —— 写 / 改类意图（W4）——
  // 动作 + 对象：写/新建/创建/保存/改名/移动/删除 …… 文件/文件夹/txt/文档/笔记
  /(写入?|写到|写上|保存|存到?|新建|创建|建立|新增|追加|改名|重命名|移动|删除|清空|整理|归类).{0,8}(文件|文件夹|目录|txt|md|文档|内容|笔记)/i,
  // 桌面/目录 语境 + 写改动作（覆盖「桌面创建一个新文件夹」「在桌面的 txt 里写…」）
  /(桌面|desktop|文件夹|目录|txt|文档).{0,10}(写入?|写上|写点|新建|创建|建个?|建立|保存|存|添加|追加|放进?|改名|重命名|移动|删除)/i,
  // 纯「新建/创建 + 对象」（无需桌面语境）
  /(新建|创建|建立|新增).{0,6}(文件|文件夹|目录|txt|文档|笔记)/,
  // 反序：对象在前、动作在后（覆盖「把这个文件重命名 / 删掉」）
  /(文件|文件夹|目录|文档|txt).{0,8}(重命名|改名|删除|删掉|移走|移动|写入?|保存|清空)/i,
  /\b(write|create|save|mkdir|rename|move|delete|remove)\b.{0,12}\b(file|files|folder|directory|txt|note)\b/i,
];

/** 强信号短语：单独出现也足够判 utility */
const FILE_STRONG_PHRASES: readonly RegExp[] = [
  /我的?桌面/,
  /桌面上/,
  /list\s+(my\s+)?desktop/i,
  // 明确点名要用工具 / 落到文件 → 实用
  /(调用|用|使用)\s*工具/,
  /(写|存|保存|新建|创建)(进|到|个|份)?.{0,4}(文件|文件夹|txt|文档|桌面)/,
];

export interface KeywordIntentResult {
  mode: IntentMode;
  confidence: number;
  /** utility 时给出具体 Agent；companion 时省略 */
  agentName?: string;
  intent?: string;
}

// =====================================================================
// 二级路由（W4）：utility 模式下选具体 Agent —— File / Dev / System
// =====================================================================

// 注：DevAgent（git）暂不做，已从二级路由移除；后续再加回。
export type UtilityAgentName = "FileAgent" | "SystemAgent";

/** 剪贴板 / 系统通知类关键词 → SystemAgent */
const SYSTEM_PATTERNS: readonly RegExp[] = [
  /剪贴板|剪切板|clipboard/i,
  /复制(到剪|这段|内容)|拷贝到剪/i,
  /(系统)?通知|notification|弹个?提醒|提醒我|notify/i,
];

export interface UtilityAgentResult {
  agent: UtilityAgentName;
  confidence: number;
}

/**
 * 二级路由：在已判 utility 的前提下，按关键词选 File / System。
 * 默认 FileAgent（文件意图最常见，也是兜底）。纯关键词；LLM 二级兜底后续可叠加。
 */
export function classifyUtilityAgent(userInput: string): UtilityAgentResult {
  const text = (userInput ?? "").trim();
  if (text) {
    for (const re of SYSTEM_PATTERNS) {
      if (re.test(text)) return { agent: "SystemAgent", confidence: 0.85 };
    }
  }
  return { agent: "FileAgent", confidence: 0.7 };
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
 * 桌面端可在 confidence 低时再挂 LLM zero-shot 兜底（见 HybridIntentRouter）。
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

/**
 * 弱任务信号：单个 token 出现就说明「可能是个文件/系统操作」，但不足以确定。
 * 仅用来决定「关键词判 companion 时，要不要花一次 LLM 兜底」——纯闲聊不命中这些词，
 * 直接走 companion，零额外延迟。
 */
const WEAK_TASK_HINTS: readonly RegExp[] = [
  /文件|文件夹|目录|桌面|desktop|txt|md|文档|笔记/i,
  /写|读|看|列|找|搜|建|创建|新建|删|移|改|存|保存|打开|整理|归类|重命名|改名/,
  /工具|帮我弄|帮我做|帮我处理|操作/,
];

export function hasWeakTaskHint(userInput: string): boolean {
  const text = (userInput ?? "").trim();
  if (!text) return false;
  return WEAK_TASK_HINTS.some((re) => re.test(text));
}

/**
 * LLM zero-shot 意图分类器（由桌面端 IO 层实现并注入，agent-core 不碰 SDK）。
 * 不确定 / 失败 / 超时一律返回 null —— 路由据此退回关键词结果，保证总有响应。
 */
export interface LlmIntentClassifier {
  classify(
    userInput: string,
    signal?: AbortSignal,
  ): Promise<KeywordIntentResult | null>;
}

export interface HybridRouterOptions {
  classifier?: LlmIntentClassifier;
  /**
   * 关键词判 companion 且置信度 < 此阈值时，才考虑 LLM 兜底。默认 0.7
   *（关键词 companion 恒为 0.6，所以默认所有 companion 都可能触发兜底——
   * 但还需先过 hasWeakTaskHint 弱信号闸，纯闲聊不会触发）。
   */
  llmFallbackBelow?: number;
}

/**
 * 混合一级路由：关键词优先 + LLM zero-shot 兜底。
 *
 * 决策顺序（兼顾快、省、准）：
 *   1. 关键词命中 utility（高置信）→ 直接用，0 网络往返、0 延迟。
 *   2. 关键词判 companion 但带「弱任务信号」且置信度低 → 调一次轻量 LLM 分类兜底。
 *   3. 其余（纯闲聊 / 无 classifier / LLM 失败或仍判 companion）→ companion。
 *
 * 弱信号闸（hasWeakTaskHint）确保普通闲聊不会平白多花一次 LLM 调用。
 */
export class HybridIntentRouter implements Router {
  private readonly classifier?: LlmIntentClassifier;
  private readonly llmFallbackBelow: number;

  constructor(opts: HybridRouterOptions = {}) {
    this.classifier = opts.classifier;
    this.llmFallbackBelow = opts.llmFallbackBelow ?? 0.7;
  }

  async route(
    userInput: string,
    ctx: Pick<AgentRunContext, "workingMemory" | "signal">,
  ): Promise<RouterResult> {
    const kw = classifyIntentByKeywords(userInput);
    if (kw.mode === "utility") {
      return { ...toResult(kw), scores: { keyword: kw.confidence } };
    }

    const shouldFallback =
      this.classifier !== undefined &&
      kw.confidence < this.llmFallbackBelow &&
      hasWeakTaskHint(userInput);

    if (shouldFallback) {
      try {
        const llm = await this.classifier!.classify(userInput, ctx.signal);
        if (llm && llm.mode === "utility") {
          return {
            ...toResult(llm),
            scores: { keyword: kw.confidence, llm: llm.confidence },
          };
        }
        if (llm) {
          return {
            ...toResult(llm),
            scores: { keyword: kw.confidence, llm: llm.confidence },
          };
        }
      } catch {
        /* LLM 失败 / 超时 / abort → 退回关键词结果 */
      }
    }

    return { ...toResult(kw), scores: { keyword: kw.confidence } };
  }
}

function toResult(r: KeywordIntentResult): RouterResult {
  return {
    mode: r.mode,
    confidence: r.confidence,
    agentName: r.agentName,
    intent: r.intent,
  };
}
