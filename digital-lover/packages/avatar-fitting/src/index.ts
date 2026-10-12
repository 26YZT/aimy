/**
 * VRM 导入建模机制（接口骨架）
 *
 * 解决 E4 追加需求：任意用户导入的 VRM 模型，
 * 经「校验 → 骨骼/表情(BlendShape)/口型映射 → 形态归一化」后，
 * 变成可动、可表情、可口型匹配的可用角色。
 *
 * 实现落点（M7）：复用 AIRI `stage-ui-three` 的 VRM 底座，
 * 补全映射与归一化逻辑。
 */

export interface AvatarImportResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  /** 映射后的运行时角色描述 */
  fitted?: FittedAvatar
}

export interface FittedAvatar {
  id: string
  /** 骨骼映射（标准动作 -> 模型骨骼路径） */
  boneMap: Record<string, string>
  /** 表情映射（标准情绪 -> BlendShape 名） */
  expressionMap: Record<string, string>
  /** 口型参数（用于 lipsync） */
  lipsync: {
    /** 口型 BlendShape 名，如 "A"/"I"/"U"/"E"/"O" */
    visemeMap: Record<string, string>
    /** 模型相对目标身高，用于形态归一化 */
    heightScale: number
  }
}

export interface AvatarFitting {
  /** 导入并校验 VRM 文件。 */
  import: (file: ArrayBuffer) => Promise<AvatarImportResult>
  /** 绑定标准动作/表情/口型到模型。 */
  fit: (model: unknown) => Promise<FittedAvatar>
  /** 预览（返回可渲染的形态摘要）。 */
  preview: (fitted: FittedAvatar) => Promise<{ ok: boolean, summary: string }>
}

/** 未实现占位：Codex 在 M7 补全。 */
export function createAvatarFitting(): AvatarFitting {
  return {
    async import() {
      throw new Error('TODO(M7): implement VRM import/validation')
    },
    async fit() {
      throw new Error('TODO(M7): implement bone/expression/lipsync mapping')
    },
    async preview() {
      throw new Error('TODO(M7): implement fitted avatar preview')
    },
  }
}
