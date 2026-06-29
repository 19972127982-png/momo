/**
 * 权限审批 toast（W4 D3）
 *
 * 工具调用前主进程请求授权时弹出：说明要做什么 + 四个选择按钮。
 * 不自己管可见性 —— App 只在有 pending 请求时渲染它。
 */
export type GrantGrade = 'once' | 'session' | 'forever' | 'deny'

export interface ApprovalRequest {
  reqId: string
  scope: 'read' | 'write' | 'exec' | 'network'
  target: string
  agentName: string
  toolName: string
}

const SCOPE_VERB: Record<ApprovalRequest['scope'], string> = {
  read: '读取',
  write: '改动',
  exec: '执行',
  network: '联网访问'
}

function describe(req: ApprovalRequest): string {
  const verb = SCOPE_VERB[req.scope]
  if (req.target) return `要不要让我${verb}「${req.target}」？`
  return `要不要让我${verb}（${req.toolName}）？`
}

interface Props {
  request: ApprovalRequest
  onRespond: (grade: GrantGrade) => void
}

export default function ApprovalToast({ request, onRespond }: Props): React.JSX.Element {
  return (
    <div className="approval-toast" role="dialog" aria-label="权限请求">
      <div className="approval-toast__msg">{describe(request)}</div>
      <div className="approval-toast__actions">
        <button className="approval-btn approval-btn--once" onClick={() => onRespond('once')}>
          本次
        </button>
        <button
          className="approval-btn approval-btn--session"
          onClick={() => onRespond('session')}
        >
          本会话
        </button>
        <button
          className="approval-btn approval-btn--forever"
          onClick={() => onRespond('forever')}
        >
          永久
        </button>
        <button className="approval-btn approval-btn--deny" onClick={() => onRespond('deny')}>
          拒绝
        </button>
      </div>
    </div>
  )
}
