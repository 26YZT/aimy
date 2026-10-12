/**
 * 长时记忆系统（接口骨架）
 *
 * 三子系统：筛选（filter）→ 提取（extract）→ 整合（consolidate），
 * 以及检索（search）。跨会话记住用户偏好/事实/情绪/关系事件。
 *
 * 实现落点（M5）：
 * - 存储：本地向量库（复用 AIRI duckdb-wasm / 改造 memory-pgvector）；
 * - 挂载：core-agent 的 onChatTurnComplete hook 触发提取；
 * - 检索结果注入 context registry 的 `memory` 桶。
 */

export type MemoryKind = 'preference' | 'fact' | 'emotion' | 'relationship_event'

export interface MemoryEntry {
  id: string
  kind: MemoryKind
  text: string
  /** 结构化字段（可选） */
  structured?: Record<string, string | number | boolean | null>
  createdAt: number
  updatedAt: number
  /** 重要性 0..1，用于筛选与优先级 */
  importance: number
  /** 冲突时用户指令优先 */
  source: 'user' | 'inferred'
}

export interface MemoryCandidate {
  kind: MemoryKind
  text: string
  importance: number
  source: 'user' | 'inferred'
}

export interface MemorySystem {
  /** 从一轮对话中筛出值得记的候选（只筛不写）。 */
  filter: (messages: Array<{ role: 'user' | 'assistant', text: string }>) => Promise<MemoryCandidate[]>
  /** 提取结构化记忆。 */
  extract: (candidate: MemoryCandidate) => Promise<MemoryEntry>
  /** 整合：去重、更新、冲突时用户指令优先。 */
  consolidate: (entries: MemoryEntry[]) => Promise<MemoryEntry[]>
  /** 检索相关记忆。 */
  search: (query: string, limit?: number) => Promise<MemoryEntry[]>
}

/** 未实现占位：Codex 在 M5 补全。 */
export function createMemorySystem(): MemorySystem {
  return {
    async filter() {
      throw new Error('TODO(M5): implement memory filtering')
    },
    async extract() {
      throw new Error('TODO(M5): implement memory extraction')
    },
    async consolidate() {
      throw new Error('TODO(M5): implement memory consolidation')
    },
    async search() {
      throw new Error('TODO(M5): implement memory search')
    },
  }
}
