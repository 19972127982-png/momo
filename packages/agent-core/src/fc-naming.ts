/**
 * Function calling 工具名的命名空间约定（W3 D6）
 *
 * 多个 MCP server 可能有同名工具（如都叫 `read`），所以对 LLM 暴露时统一命名空间化：
 *   `${serverId}__${toolName}`
 * 分隔符用双下划线 `__`（DeepSeek/OpenAI 工具名只允许 [a-zA-Z0-9_-]，双下划线安全且少见于工具名）。
 *
 * 放在 agent-core：FileAgent（解析 LLM 回传的工具名）和 mcp-host（生成工具名）都要用，
 * 放这里避免 agent-core 反向依赖 mcp-host。
 */

const SEP = "__";

export function namespaceToolName(serverId: string, toolName: string): string {
  return `${serverId}${SEP}${toolName}`;
}

export interface ParsedToolName {
  serverId: string;
  toolName: string;
}

/**
 * 拆出 serverId / toolName。
 * 没有分隔符（理论不该发生）时，serverId 置空、整串当 toolName，调用方自行兜底。
 * toolName 里若还含 `__`（少见），只按第一个分隔符拆，其余归入 toolName。
 */
export function parseNamespacedToolName(fcName: string): ParsedToolName {
  const idx = fcName.indexOf(SEP);
  if (idx === -1) return { serverId: "", toolName: fcName };
  return {
    serverId: fcName.slice(0, idx),
    toolName: fcName.slice(idx + SEP.length),
  };
}
