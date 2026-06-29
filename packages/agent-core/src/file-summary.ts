/**
 * 拖文件总结 —— 纯逻辑（W3 副线）
 *
 * 桌宠收到用户拖入的文件/图片后，要：
 *   1. 判类型（文本 / 图片 / 不支持）—— classifyDroppedFile
 *   2. 文本/OCR 内容过长先截断 —— truncateForSummary
 *   3. 用「人格口吻」拼一段总结 prompt —— buildFileSummaryMessages
 *   4. 边界情况（OCR 没文字 / 不支持类型）给固定的人格化提示 —— *Reply 系列
 *
 * 这里只放确定性纯函数，便于单测；真正读文件 / 调 OCR / 调 LLM 在 apps/desktop。
 */
import type { ChatCompletionMessage } from "./types";

export type DroppedFileKind = "text" | "image" | "unsupported";

/** 当作纯文本读取的扩展名（不含点，小写） */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "rst",
  "log",
  "text",
  "json",
  "jsonc",
  "csv",
  "tsv",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "cfg",
  "properties",
  "env",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "scala",
  "go",
  "rs",
  "swift",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "hh",
  "cs",
  "m",
  "mm",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "sql",
  "graphql",
  "gql",
  "proto",
  "gradle",
  "r",
  "lua",
  "pl",
  "dart",
  "ex",
  "exs",
]);

/** OCR 抽文字的图片扩展名 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "gif",
  "tiff",
  "tif",
]);

/** 没扩展名但应按文本处理的常见文件名（小写） */
const TEXT_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "changelog",
  ".gitignore",
  ".npmrc",
  ".env",
  ".editorconfig",
  ".prettierrc",
  ".babelrc",
]);

/** 取路径里的纯文件名（兼容 / 和 \） */
function basename(filename: string): string {
  return filename.toLowerCase().split(/[\\/]/).pop() ?? "";
}

export function classifyDroppedFile(filename: string): DroppedFileKind {
  const base = basename(filename);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  if (ext && IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext && TEXT_EXTENSIONS.has(ext)) return "text";
  if (TEXT_FILENAMES.has(base)) return "text";
  return "unsupported";
}

/** 单次总结喂给 LLM 的内容上限（字符）—— 控制 token / 成本，超出截断 */
export const SUMMARY_MAX_CHARS = 12_000;

export function truncateForSummary(
  text: string,
  maxChars: number = SUMMARY_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

export interface FileSummaryInput {
  personaName: string;
  userCalling?: string;
  filename: string;
  kind: "text" | "image";
  /** 文本文件内容，或图片 OCR 出的文字 */
  content: string;
  /** content 是否已被截断 */
  truncated?: boolean;
}

function callingClause(userCalling?: string): string {
  const c = userCalling?.trim();
  return c ? `用户希望你称呼 ta 为「${c}」。` : "";
}

/**
 * 拼总结 prompt。system 给人格 + 总结要求，user 给文件内容。
 * 约定调用方只在 content 非空时调用本函数（空内容走 emptyImageTextReply）。
 */
export function buildFileSummaryMessages(
  input: FileSummaryInput,
): ChatCompletionMessage[] {
  const { personaName, userCalling, filename, kind, content, truncated } =
    input;
  const truncNote = truncated ? "（内容较长，下面只是开头一部分）" : "";

  const system: ChatCompletionMessage = {
    role: "system",
    content: `你是「${personaName}」，住在用户桌面的小伙伴。${callingClause(userCalling)}
用户把一个文件拖给了你，请用你自然、亲切的口语口吻，帮 ta 快速读懂这个文件：
- 先一句话说这是个啥（类型/主题），再用 2-4 个要点概括核心内容；
- 像朋友聊天那样说人话，别贴原始内容、别用 markdown 标题、别长篇大论（控制在 150 字内）；
- 如果内容看起来是代码，就说它大概在干嘛。`,
  };

  const userContent =
    kind === "image"
      ? `这是一张图片「${filename}」，我用 OCR 从里面识别出这些文字${truncNote}：\n\n${content}\n\n帮 ta 概括下这张图大概在讲什么。`
      : `这是文件「${filename}」的内容${truncNote}：\n\n${content}\n\n帮 ta 讲讲这个文件讲了啥、重点是什么。`;

  return [system, { role: "user", content: userContent }];
}

/** 图片 OCR 没识别出文字时的人格化提示 */
export function emptyImageTextReply(personaName: string): string {
  return `唔…这张图我盯着看了半天，没认出里面有什么文字诶。如果是张照片或者图标，我现在还看不懂画面内容啦（${personaName}暂时只会认图里的字）～`;
}

/** 拖了不支持类型时的人格化提示 */
export function unsupportedFileReply(filename: string): string {
  const base = basename(filename);
  return `「${base}」这种文件我现在还读不了呢～我能看懂文本类文件（比如 txt、md、代码、json 这些）和图片里的文字，换一个试试？`;
}
