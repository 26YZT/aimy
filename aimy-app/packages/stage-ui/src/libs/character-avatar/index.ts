import * as v from 'valibot'

/** Avatar input follows the existing local image formats and bounds. Persisted thumbnails have a smaller dedicated limit. */
export const AVATAR_INPUT_BYTES = 2 * 1024 * 1024
export const AVATAR_INPUT_EDGE = 4096
export const AVATAR_EDGE = 256
export const AVATAR_DATA_URL_BYTES = 256 * 1024

export type CharacterAvatarErrorCode = 'format' | 'size' | 'image' | 'dimensions' | 'encoded-size' | 'missing' | 'changed' | 'storage'

/** Only a bounded code crosses the UI and synchronization boundary. */
export class CharacterAvatarError extends Error {
  constructor(public readonly code: CharacterAvatarErrorCode) {
    super(`Character avatar: ${code}`)
  }
}

export interface CharacterAvatarUpdate {
  cardId: string
  ownerId: string
  activeCardId: string
  expectedAvatar: string | null
  avatar: string | null
  requestId?: string
  requestedAt?: number
}

export interface CharacterAvatarCancellation {
  requestId: string
  requestedAt: number
  ownerId: string
}

const identitySchema = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const timestampSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const requestIdSchema = v.pipe(v.string(), v.uuid())
const cancellationSchema = v.strictObject({ requestId: requestIdSchema, requestedAt: timestampSchema, ownerId: identitySchema })
const updateSchema = v.pipe(v.strictObject({
  cardId: identitySchema,
  ownerId: identitySchema,
  activeCardId: identitySchema,
  expectedAvatar: v.nullable(v.string()),
  avatar: v.nullable(v.string()),
  requestId: v.optional(requestIdSchema),
  requestedAt: v.optional(timestampSchema),
}), v.check(input => (input.requestId === undefined) === (input.requestedAt === undefined)))

/** Validates the serializable command before any decoding or persisted state changes. */
export function parseCharacterAvatarUpdate(input: unknown): CharacterAvatarUpdate {
  const result = v.safeParse(updateSchema, input)
  if (!result.success)
    throw new CharacterAvatarError('changed')
  return result.output
}

/** Validates a revocation token without reading card data. */
export function parseCharacterAvatarCancellation(input: unknown): CharacterAvatarCancellation {
  const result = v.safeParse(cancellationSchema, input)
  if (!result.success)
    throw new CharacterAvatarError('changed')
  return result.output
}

/** Converts a local image to a small persistent thumbnail. Temporary object URLs never leave this function. */
export async function prepareCharacterAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new CharacterAvatarError('format')
  if (file.size > AVATAR_INPUT_BYTES)
    throw new CharacterAvatarError('size')
  if (!file.size)
    throw new CharacterAvatarError('image')
  const source = URL.createObjectURL(file)
  try {
    const image = await decode(source)
    if (image.naturalWidth > AVATAR_INPUT_EDGE || image.naturalHeight > AVATAR_INPUT_EDGE)
      throw new CharacterAvatarError('dimensions')
    const scale = Math.min(1, AVATAR_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const painter = canvas.getContext('2d')
    if (!painter)
      throw new CharacterAvatarError('image')
    painter.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL('image/webp', 0.86)
    checkDataUrl(result)
    return result
  }
  finally {
    URL.revokeObjectURL(source)
  }
}

function checkDataUrl(value: string): void {
  if (value.length > AVATAR_DATA_URL_BYTES)
    throw new CharacterAvatarError('encoded-size')
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Z\d+/]+={0,2}$/i.test(value))
    throw new CharacterAvatarError('format')
}

async function decode(source: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  if (signal?.aborted)
    throw new CharacterAvatarError('changed')
  const image = new Image()
  image.src = source
  let removeAbort = () => {}
  try {
    const decoding = image.decode()
    if (signal) {
      const cancelled = new Promise<never>((_, reject) => {
        const cancel = () => {
          image.removeAttribute('src')
          reject(new CharacterAvatarError('changed'))
        }
        signal.addEventListener('abort', cancel, { once: true })
        removeAbort = () => signal.removeEventListener('abort', cancel)
        if (signal.aborted)
          cancel()
      })
      await Promise.race([decoding, cancelled])
    }
    else {
      await decoding
    }
  }
  catch {
    throw new CharacterAvatarError(signal?.aborted ? 'changed' : 'image')
  }
  finally {
    removeAbort()
  }
  if (!image.naturalWidth || !image.naturalHeight)
    throw new CharacterAvatarError('image')
  return image
}

/** Rechecks the persisted representation at the leader boundary, including real image dimensions. */
export async function validateCharacterAvatar(value: string, signal?: AbortSignal): Promise<void> {
  checkDataUrl(value)
  const image = await decode(value, signal)
  if (image.naturalWidth > AVATAR_EDGE || image.naturalHeight > AVATAR_EDGE)
    throw new CharacterAvatarError('dimensions')
}
