/**
 * 主动陪伴引擎（接口骨架）
 *
 * 三段式决策：要不要说 → 说什么 → 用什么情绪说。
 * 负责 A1「全主动」与 F7「搭话频率/安静模式」的产品约束。
 *
 * 实现落点（M3）：
 * - observeScreen/observeVoice 复用 AIRI vision + pipelines-audio；
 * - judgeInterruption 用独立小模型/规则先判「打扰度」，超阈值则沉默；
 * - 结果作为 spark 事件或直接驱动角色搭话。
 */

export { createPerceptionGate } from './perception-gate'
export type { CaptureKind, CaptureLease } from './perception-gate'

/** 屏幕观察结果（由 vision 模块产出）。 */
export interface ScreenObservation {
  /** 前台应用名 */
  app: string
  /** 屏幕内容理解（自然语言摘要） */
  summary: string
  capturedAt: number
}

/** 语音观察结果（由 ASR 模块产出）。 */
export interface VoiceObservation {
  transcript: string
  /** 用户正在说话 */
  speaking: boolean
  capturedAt: number
}

export interface IdleSignal {
  /** 距上次键盘/鼠标活动的毫秒数 */
  idleMs: number
}

export type Observation =
  | { kind: 'screen', data: ScreenObservation }
  | { kind: 'voice', data: VoiceObservation }
  | { kind: 'idle', data: IdleSignal }

export interface CompanionContext {
  /** 当前关系快照（来自 relationship-engine） */
  relationship: {
    stage: string
    affinity: number
    emotion: string
    emotionIntensity: number
  }
  /** 用户偏好（来自 memory） */
  memoryHints: string[]
  /** 隐私开关：屏幕/麦克风是否被关闭 */
  privacy: {
    screenEnabled: boolean
    micEnabled: boolean
    quietMode: boolean
    talkFrequency: 'low' | 'medium' | 'high'
  }
}

export type SpeakDecisionReason = 'silent' | 'reply' | 'interject'

export interface CompanionDecision {
  shouldSpeak: boolean
  reason: SpeakDecisionReason
  /** 建议的情绪（交给渲染/语音） */
  emotionHint: string
  /** 建议说的话（由 LLM 生成后回填） */
  text?: string
  /** 打扰度 0..100，供埋点与调参 */
  interruptionScore: number
}

export interface CompanionEngine {
  observe: (observation: Observation) => void
  decide: (context: CompanionContext) => CompanionDecision
  /** 重置本轮观察缓冲 */
  reset: () => void
}

/** 未实现占位：Codex 在 M3 补全。 */
export function createCompanionEngine(): CompanionEngine {
  const observations: Observation[] = []
  return {
    observe(observation) {
      observations.push(observation)
    },
    decide() {
      throw new Error('TODO(M3): implement interruption scoring + speak decision')
    },
    reset() {
      observations.length = 0
    },
  }
}
