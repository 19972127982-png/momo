import { assign, setup } from 'xstate'
import type { PetContext, PetEvent, PetMotionGroup } from './types'

/**
 * petMachine —— 桌宠主行为状态机（XState v5）
 *
 * 状态：idle / listening / thinking / speaking / done / apologetic
 *
 * 关键设计：
 *   - 所有 motion 动作通过 entry action `playMotion` 派发，包含 group 参数。
 *     Renderer 用 `machine.provide({ actions: ... })` 注入真实 model.motion() 实现。
 *     这样 state-machine 包零依赖（无 PIXI / Electron），可单测。
 *   - showInputBox / hideInputBox 同理 —— renderer provide 覆盖。
 *   - `done` 是稳态（不再自动归位 idle），气泡淡出由 UI 层 timer 独立控制；
 *     `apologetic` 仍保留 3s after 兜底，但允许用户即时操作打断。
 *   - thinking 的兜底：即使 renderer 漏发 `agent.thinking-end`，
 *     直接收到 `agent.stream-chunk` 也能切到 speaking 并累积，
 *     收到 `agent.stream-end` 也能直接切到 done（零 token 不卡死）。
 *   - LipSync 不做：speaking 阶段不驱动嘴部参数。
 */

export type PetActionType = 'playMotion' | 'showInputBox' | 'hideInputBox'

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
      lastError: ({ event }) => {
        if (event.type !== 'agent.error') return null
        return event.error
      }
    }),
    clearError: assign({ lastError: null })
  }
}).createMachine({
  id: 'pet',
  initial: 'idle',
  context: { streamText: '', lastError: null },
  states: {
    idle: {
      entry: 'clearError',
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
      on: {
        'agent.thinking-end': { target: 'speaking' },
        // 兜底：renderer 忘发 thinking-end 也能在首个 chunk 触发切换并累积
        'agent.stream-chunk': { target: 'speaking', actions: 'appendStreamText' },
        // 兜底：零 token 回复（仅 [DONE]）不卡死，直接走 done
        'agent.stream-end': { target: 'done' },
        'agent.error': { target: 'apologetic' }
      }
    },

    speaking: {
      entry: { type: 'playMotion', params: { group: 'Tap' } },
      on: {
        'agent.stream-chunk': {
          actions: 'appendStreamText'
        },
        'agent.stream-end': { target: 'done' },
        'agent.error': { target: 'apologetic' }
      }
    },

    done: {
      // 不再自动归位 idle —— done 是「刚说完话」的稳态，
      // 等用户主动 click / send 再切走，否则气泡 fade 会和问候语切回 race
      on: {
        'user.send': { target: 'thinking' },
        'ui.pet-click': { target: 'listening' }
      }
    },

    apologetic: {
      entry: [
        { type: 'playMotion', params: { group: 'FlickDown' } },
        'recordError'
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
