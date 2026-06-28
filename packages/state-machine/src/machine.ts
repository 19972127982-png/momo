import { assign, setup } from 'xstate'
import type { PendingToolCall, PetContext, PetEvent, PetMotionGroup } from './types'

/**
 * petMachine —— 桌宠主行为状态机（XState v5）
 *
 * 顶层状态：idle / listening / thinking / speaking / done / apologetic
 * v2.1 W3 NEW：thinking 是 compound state，4 个 sub-state
 *
 *                            ┌─────────────────────── thinking ───────────────────────┐
 *                            │   deciding                                              │
 *   idle ──ui.pet-click──→ listening ──user.send──→ thinking.deciding                  │
 *                                                     │ agent.thinking-end → speaking  │
 *                                                     │ agent.stream-chunk → speaking  │
 *                                                     │ agent.stream-end → done        │
 *                                                     │ agent.want-tool → awaitApproval│
 *                                                     │ agent.error → apologetic       │
 *                            │                                                          │
 *                            │   awaitingApproval                                        │
 *                            │     user.approve → acting                                 │
 *                            │     user.deny → apologetic                                │
 *                            │     after 30s → apologetic                                │
 *                            │                                                          │
 *                            │   acting                                                  │
 *                            │     tool.call-end → observing                             │
 *                            │     tool.error → apologetic                               │
 *                            │     after 15s → apologetic                                │
 *                            │                                                          │
 *                            │   observing                                               │
 *                            │     agent.continue → deciding (if <MAX_STEPS)             │
 *                            │     agent.thinking-end → speaking                         │
 *                            │     agent.stream-chunk → speaking                         │
 *                            │     agent.stream-end → done                               │
 *                            │     agent.error → apologetic                              │
 *                            └──────────────────────────────────────────────────────────┘
 *
 * 关键设计：
 *   - 所有 motion 动作通过 entry action `playMotion` 派发，包含 group 参数。
 *     Renderer 用 `machine.provide({ actions: ... })` 注入真实 model.motion() 实现。
 *   - showInputBox / hideInputBox 同理 —— renderer provide 覆盖。
 *   - `done` 是稳态（不再自动归位 idle），气泡淡出由 UI 层 timer 独立控制；
 *     `apologetic` 仍保留 3s after 兜底，允许用户即时操作打断。
 *   - thinking.deciding 的兜底：renderer 漏发 `agent.thinking-end`，
 *     直接收到 `agent.stream-chunk` 也能切到 speaking 并累积。
 *   - **W3 NEW**：ReAct loop 通过 `agent.continue` 从 observing 回 deciding；
 *     `toolSteps` 计数器达到 MAX_TOOL_STEPS 时 want-tool 直接 reject 到 apologetic。
 *   - **W3 NEW**：`awaitingApproval` 30s timeout + `acting` 15s timeout 全部走 apologetic。
 *   - LipSync 不做：speaking 阶段不驱动嘴部参数。
 */

export const MAX_TOOL_STEPS = 8
export const TOOL_TIMEOUT_MS = 15_000
export const APPROVAL_TIMEOUT_MS = 30_000

export type PetActionType =
  | 'playMotion'
  | 'showInputBox'
  | 'hideInputBox'

export interface PlayMotionAction {
  type: 'playMotion'
  params: { group: PetMotionGroup }
}

export const petMachine = setup({
  types: {
    context: {} as PetContext,
    events: {} as PetEvent
  },
  actions: {
    // 默认实现都是 noop；renderer 用 `provide({ actions: ... })` 覆盖
    playMotion: (_, _params: { group: PetMotionGroup }) => {
      // noop —— renderer 注入时调 model.motion(params.group, undefined, FORCE)
    },
    showInputBox: () => {
      // noop —— renderer 注入时显示 ChatInput
    },
    hideInputBox: () => {
      // noop —— renderer 注入时隐藏 ChatInput
    },
    resetStreamText: assign({ streamText: '' }),
    appendStreamText: assign({
      streamText: ({ context, event }) => {
        if (event.type !== 'agent.stream-chunk') return context.streamText
        return context.streamText + event.text
      }
    }),
    recordError: assign({
      lastError: ({ context, event }) => {
        // 优先用 event 自带的错误字符串；否则保留 context.lastError（可能是
        // 来源 transition 上的 setReason* action 刚写入的描述）。
        if (event.type === 'agent.error') return event.error
        if (event.type === 'tool.error') return event.error
        return context.lastError
      }
    }),
    clearError: assign({ lastError: null }),
    // ---- v2.1 W3 NEW ----
    setPendingToolCall: assign({
      pendingToolCall: ({ event }): PendingToolCall | null => {
        if (event.type !== 'agent.want-tool') return null
        return event.payload
      }
    }),
    clearPendingToolCall: assign({ pendingToolCall: null }),
    incrementToolSteps: assign({
      toolSteps: ({ context }) => context.toolSteps + 1
    }),
    resetToolSteps: assign({ toolSteps: 0 }),
    recordToolResult: assign({
      lastToolResult: ({ event }) => {
        if (event.type !== 'tool.call-end') return null
        return event.resultSummary
      }
    }),
    setReasonMaxSteps: assign({
      lastError: () => `ReAct loop 达到 ${MAX_TOOL_STEPS} 步上限`
    }),
    setReasonApprovalTimeout: assign({
      lastError: () => '审批超时（30s），默认拒绝'
    }),
    setReasonToolTimeout: assign({
      lastError: () => `工具调用超时（${TOOL_TIMEOUT_MS / 1000}s）`
    }),
    setReasonUserDeny: assign({
      lastError: () => '用户拒绝了工具调用'
    })
  },
  guards: {
    underMaxSteps: ({ context }) => context.toolSteps < MAX_TOOL_STEPS
  }
}).createMachine({
  id: 'pet',
  initial: 'idle',
  context: {
    streamText: '',
    lastError: null,
    pendingToolCall: null,
    toolSteps: 0,
    lastToolResult: null
  },
  states: {
    idle: {
      entry: ['clearError', 'clearPendingToolCall', 'resetToolSteps'],
      on: {
        'ui.pet-click': { target: 'listening' },
        'user.send': { target: 'thinking' }
      }
    },

    listening: {
      entry: [
        { type: 'playMotion', params: { group: 'FlickUp' } },
        { type: 'showInputBox' }
      ],
      exit: { type: 'hideInputBox' },
      on: {
        'user.send': { target: 'thinking' },
        'ui.input-blur': { target: 'idle' }
      }
    },

    thinking: {
      // motion 不切，pixi-live2d-display 自动循环 Idle group
      entry: 'resetStreamText',
      initial: 'deciding',
      states: {
        deciding: {
          on: {
            'agent.thinking-end': { target: '#pet.speaking' },
            // 兜底：renderer 忘发 thinking-end 也能在首个 chunk 触发切换并累积
            'agent.stream-chunk': { target: '#pet.speaking', actions: 'appendStreamText' },
            // 兜底：零 token 回复（仅 [DONE]）不卡死，直接走 done
            'agent.stream-end': { target: '#pet.done' },
            'agent.want-tool': [
              {
                target: 'awaitingApproval',
                guard: 'underMaxSteps',
                actions: 'setPendingToolCall'
              },
              {
                // 超出 MAX_STEPS 直接 apologetic
                target: '#pet.apologetic',
                actions: 'setReasonMaxSteps'
              }
            ],
            'agent.error': { target: '#pet.apologetic', actions: 'recordError' }
          }
        },
        awaitingApproval: {
          // 询问态：先复用 Tap motion，W4 可换自定义 Inquiry motion
          entry: { type: 'playMotion', params: { group: 'Tap' } },
          after: {
            [APPROVAL_TIMEOUT_MS]: {
              target: '#pet.apologetic',
              actions: 'setReasonApprovalTimeout'
            }
          },
          on: {
            'user.approve': {
              target: 'acting',
              actions: ['incrementToolSteps', 'clearPendingToolCall']
            },
            'user.deny': {
              target: '#pet.apologetic',
              actions: ['clearPendingToolCall', 'setReasonUserDeny']
            }
          }
        },
        acting: {
          after: {
            [TOOL_TIMEOUT_MS]: {
              target: '#pet.apologetic',
              actions: 'setReasonToolTimeout'
            }
          },
          on: {
            'tool.call-end': {
              target: 'observing',
              actions: 'recordToolResult'
            },
            'tool.error': {
              target: '#pet.apologetic',
              actions: 'recordError'
            }
          }
        },
        observing: {
          on: {
            'agent.continue': { target: 'deciding' },
            'agent.thinking-end': { target: '#pet.speaking' },
            'agent.stream-chunk': { target: '#pet.speaking', actions: 'appendStreamText' },
            'agent.stream-end': { target: '#pet.done' },
            'agent.error': { target: '#pet.apologetic', actions: 'recordError' }
          }
        }
      }
    },

    speaking: {
      entry: { type: 'playMotion', params: { group: 'Tap' } },
      on: {
        'agent.stream-chunk': {
          actions: 'appendStreamText'
        },
        'agent.stream-end': { target: 'done' },
        'agent.error': { target: 'apologetic', actions: 'recordError' }
      }
    },

    done: {
      // 不再自动归位 idle —— done 是「刚说完话」的稳态
      entry: 'resetToolSteps',
      on: {
        'user.send': { target: 'thinking' },
        'ui.pet-click': { target: 'listening' }
      }
    },

    apologetic: {
      entry: [
        { type: 'playMotion', params: { group: 'FlickDown' } },
        'recordError',
        'clearPendingToolCall',
        'resetToolSteps'
      ],
      after: { 3000: { target: 'idle' } },
      on: {
        // 用户不需要等 3s after 兜底，直接重试或点角色就能脱离 apologetic
        'user.send': { target: 'thinking' },
        'ui.pet-click': { target: 'listening' }
      }
    }
  }
})

export type PetMachine = typeof petMachine
