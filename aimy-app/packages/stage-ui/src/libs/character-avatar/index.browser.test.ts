import { describe, expect, it, vi } from 'vitest'

import { AVATAR_DATA_URL_BYTES, AVATAR_INPUT_BYTES, prepareCharacterAvatar, validateCharacterAvatar } from './index'

async function picture(type = 'image/png', width = 600, height = 300): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const painter = canvas.getContext('2d')!
  painter.fillStyle = '#e096ac'
  painter.fillRect(0, 0, width, height)
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), type))
  return new File([blob], 'synthetic-image', { type })
}

describe('local character avatar preparation', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('decodes and limits a real %s image', async (type) => {
    const result = await prepareCharacterAvatar(await picture(type))
    expect(result).toMatch(/^data:image\/webp;base64,/)
    expect(result.length).toBeLessThanOrEqual(AVATAR_DATA_URL_BYTES)
    const image = new Image()
    image.src = result
    await image.decode()
    expect(image.naturalWidth).toBe(256)
    expect(image.naturalHeight).toBe(128)
    await expect(validateCharacterAvatar(result)).resolves.toBeUndefined()
  })

  it('rejects unsupported, oversized, empty and malformed source files', async () => {
    await expect(prepareCharacterAvatar(new File(['x'], 'bad.gif', { type: 'image/gif' }))).rejects.toThrow('format')
    await expect(prepareCharacterAvatar(new File([new Uint8Array(AVATAR_INPUT_BYTES + 1)], 'large.png', { type: 'image/png' }))).rejects.toThrow('size')
    await expect(prepareCharacterAvatar(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow('image')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await expect(prepareCharacterAvatar(new File(['not an image'], 'broken.png', { type: 'image/png' }))).rejects.toThrow('image')
    expect(revoke).toHaveBeenCalledOnce()
    revoke.mockRestore()
    await expect(prepareCharacterAvatar(await picture('image/png', 4097, 1))).rejects.toThrow('dimensions')
  })

  it('rejects remote, temporary, oversized encoded and unnormalized images at the save boundary', async () => {
    for (const invalid of ['https://example.invalid/private.png', 'blob:temporary', 'data:image/svg+xml;base64,PHN2Zz4='])
      await expect(validateCharacterAvatar(invalid)).rejects.toThrow('format')
    await expect(validateCharacterAvatar(`data:image/png;base64,${'A'.repeat(AVATAR_DATA_URL_BYTES)}`)).rejects.toThrow('encoded-size')
    const image = await picture('image/png', 300, 1)
    const source = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(image)
    })
    await expect(validateCharacterAvatar(source)).rejects.toThrow('dimensions')
  })
})
