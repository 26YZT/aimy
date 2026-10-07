/**
 * 恋爱关系状态机（数字恋人的核心领域模块）
 *
 * 五档阶段 + 好感度 + 瞬时情绪（含负面情绪与恢复路径）。
 * 纯函数式、无运行时依赖，可直接挂到 core-agent 的 hook 上随对话更新。
 */

export type RelationshipStage = 'initial' | 'familiar' | 'ambiguous' | 'lover' | 'intimate'

export type Emotion = 'neutral' | 'happy' | 'shy' | 'jealous' | 'angry' | 'upset'

/** 一次关系事件：来自对话/屏幕观察/记忆唤起的领域语义。 */
export type RelationshipEvent =
  | { type: 'chat' }
  | { type: 'user_share' }
  | { type: 'user_compliment' }
  | { type: 'user_cold' }
  | { type: 'user_with_other' }
  | { type: 'user_apologize' }
  | { type: 'memory_recalled' }

export interface RelationshipSnapshot {
  stage: RelationshipStage
  /** 好感度 0..100 */
  affinity: number
  /** 当前瞬时情绪 */
  emotion: Emotion
  /** 情绪强度 0..100 */
  emotionIntensity: number
}

export interface RelationshipEffect {
  /** 本次事件带来的好感度变化（已 clamp） */
  affinityDelta: number
  /** 事件后的情绪 */
  emotion: Emotion
  emotionIntensity: number
  stageBefore: RelationshipStage
  stageAfter: RelationshipStage
  stageChanged: boolean
  /** 给渲染/语音的表情动作提示（例如 jealous -> 侧目嘟嘴） */
  expressionHint: string
}

export interface RelationshipConfig {
  /** 各阶段的好感度下限 */
  stageMin: Record<RelationshipStage, number>
  /** 降级滞回：只有低于当前阶段下限 - 该值才降级，避免好感度在阈值附近抖动 */
  downgradeHysteresis: number
  /** settle() 每步情绪强度的衰减量 */
  emotionDecayStep: number
  /** 事件效果表 */
  effects: Record<RelationshipEvent['type'], { affinityDelta: number, emotion: Emotion, emotionIntensity: number }>
  /** 情绪 -> 3D 表情/动作提示 */
  expressionHints: Record<Emotion, string>
}

export const STAGE_ORDER: RelationshipStage[] = ['initial', 'familiar', 'ambiguous', 'lover', 'intimate']

export const DEFAULT_CONFIG: RelationshipConfig = {
  stageMin: { initial: 0, familiar: 20, ambiguous: 40, lover: 60, intimate: 80 },
  downgradeHysteresis: 10,
  emotionDecayStep: 5,
  effects: {
    chat: { affinityDelta: 0.5, emotion: 'neutral', emotionIntensity: 0 },
    user_share: { affinityDelta: 2, emotion: 'happy', emotionIntensity: 40 },
    user_compliment: { affinityDelta: 3, emotion: 'happy', emotionIntensity: 60 },
    user_cold: { affinityDelta: -3, emotion: 'upset', emotionIntensity: 50 },
    user_with_other: { affinityDelta: -2, emotion: 'jealous', emotionIntensity: 70 },
    user_apologize: { affinityDelta: 2, emotion: 'neutral', emotionIntensity: 0 },
    memory_recalled: { affinityDelta: 2, emotion: 'shy', emotionIntensity: 50 },
  },
  expressionHints: {
    neutral: '自然注视',
    happy: '微笑',
    shy: '低头 + 脸红',
    jealous: '侧目 + 嘟嘴',
    angry: '皱眉 + 双臂抱胸',
    upset: '垂眼 + 沉默',
  },
}

const NEGATIVE_EMOTIONS: Emotion[] = ['jealous', 'angry', 'upset']

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function stageIndex(stage: RelationshipStage) {
  return STAGE_ORDER.indexOf(stage)
}

/** 根据当前阶段 + 好感度计算下一阶段（升级即时、降级滞回）。 */
export function resolveStage(current: RelationshipStage, affinity: number, config: RelationshipConfig = DEFAULT_CONFIG): RelationshipStage {
  let target: RelationshipStage = 'initial'
  for (const stage of STAGE_ORDER) {
    if (affinity >= config.stageMin[stage])
      target = stage
  }
  const cur = stageIndex(current)
  const tgt = stageIndex(target)
  if (tgt > cur)
    return target
  if (tgt < cur) {
    return affinity < config.stageMin[current] - config.downgradeHysteresis ? target : current
  }
  return current
}

export interface RelationshipEngine {
  apply: (event: RelationshipEvent) => RelationshipEffect
  /** 随时间衰减情绪强度；情绪归零后回到 neutral。 */
  settle: (step?: number) => RelationshipSnapshot
  snapshot: () => RelationshipSnapshot
  readonly stage: RelationshipStage
  readonly affinity: number
  readonly emotion: Emotion
  readonly emotionIntensity: number
}

export function createRelationshipEngine(config: Partial<RelationshipConfig> = {}): RelationshipEngine {
  const cfg: RelationshipConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    stageMin: { ...DEFAULT_CONFIG.stageMin, ...config.stageMin },
    effects: { ...DEFAULT_CONFIG.effects, ...config.effects },
    expressionHints: { ...DEFAULT_CONFIG.expressionHints, ...config.expressionHints },
  }

  let stage: RelationshipStage = 'initial'
  let affinity = 0
  let emotion: Emotion = 'neutral'
  let emotionIntensity = 0

  function applyEffect(event: RelationshipEvent, effect: (typeof cfg.effects)[RelationshipEvent['type']]) {
    affinity = clamp(affinity + effect.affinityDelta)

    // 负向事件叠加/触发；道歉清空负向情绪；正向事件可覆盖负向情绪。
    if (event.type === 'user_apologize') {
      emotion = 'neutral'
      emotionIntensity = 0
    }
    else if (effect.emotion === 'neutral' && !NEGATIVE_EMOTIONS.includes(emotion)) {
      // 中性事件且当前无负向情绪：保持现状
    }
    else {
      emotion = effect.emotion
      emotionIntensity = clamp(Math.max(emotionIntensity, effect.emotionIntensity))
    }

    const stageBefore = stage
    const stageAfter = resolveStage(stage, affinity, cfg)
    const stageChanged = stageBefore !== stageAfter
    stage = stageAfter

    return {
      affinityDelta: effect.affinityDelta,
      emotion,
      emotionIntensity,
      stageBefore,
      stageAfter,
      stageChanged,
      expressionHint: cfg.expressionHints[emotion],
    }
  }

  return {
    apply(event) {
      return applyEffect(event, cfg.effects[event.type])
    },
    settle(step = cfg.emotionDecayStep) {
      if (emotionIntensity > 0) {
        emotionIntensity = clamp(emotionIntensity - step, 0, 100)
        if (emotionIntensity === 0)
          emotion = 'neutral'
      }
      return this.snapshot()
    },
    snapshot() {
      return { stage, affinity, emotion, emotionIntensity }
    },
    get stage() {
      return stage
    },
    get affinity() {
      return affinity
    },
    get emotion() {
      return emotion
    },
    get emotionIntensity() {
      return emotionIntensity
    },
  }
}
