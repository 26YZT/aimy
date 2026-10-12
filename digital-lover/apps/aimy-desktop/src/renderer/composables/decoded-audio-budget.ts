export const MAX_SEGMENT_SECONDS = 15
export const MAX_SEGMENT_BYTES = 8 * 1024 * 1024
export const MAX_QUEUED_SECONDS = 45
export const MAX_QUEUED_BYTES = 24 * 1024 * 1024
export const MAX_NATIVE_DECODES = 2

export interface AudioCost { bytes: number, seconds: number }
interface Reservation extends AudioCost { generation: number, id: number, phase: 'decoding' | 'ready' }

/** Parse bounded uncompressed WAV headers before asking the browser to allocate PCM. */
export function estimateWavCost(bytes: Uint8Array<ArrayBuffer>, outputSampleRate: number): AudioCost | undefined {
  if (bytes.byteLength < 44 || !Number.isFinite(outputSampleRate) || outputSampleRate <= 0 || outputSampleRate > 192000)
    return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength)
    return
  let channels = 0
  let sampleRate = 0
  let blockAlign = 0
  let dataBytes = 0
  let fmtFound = false
  let dataFound = false
  let offset = 12
  for (let count = 0; offset + 8 <= bytes.byteLength && count < 64; count++) {
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + size > bytes.byteLength)
      return
    if (tag(offset) === 'fmt ') {
      if (fmtFound || size < 16)
        return
      const format = view.getUint16(start, true)
      channels = view.getUint16(start + 2, true)
      sampleRate = view.getUint32(start + 4, true)
      const byteRate = view.getUint32(start + 8, true)
      blockAlign = view.getUint16(start + 12, true)
      const bits = view.getUint16(start + 14, true)
      if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && [32, 64].includes(bits)))
        || channels < 1 || channels > 8 || sampleRate < 8000 || sampleRate > 192000
        || blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign)
        return
      fmtFound = true
    }
    else if (tag(offset) === 'data') {
      if (dataFound || !size)
        return
      dataBytes = size
      dataFound = true
    }
    offset = start + size + (size % 2)
  }
  if (offset !== bytes.byteLength || !fmtFound || !dataFound || dataBytes % blockAlign !== 0)
    return
  const seconds = dataBytes / (sampleRate * blockAlign)
  const decodedBytes = Math.ceil(seconds * outputSampleRate) * channels * 4
  if (seconds <= 0 || seconds > MAX_SEGMENT_SECONDS || decodedBytes > MAX_SEGMENT_BYTES)
    return
  return { seconds, bytes: decodedBytes }
}

/** Reservations cover decoding, ordered timeline buffers, queue and current playback. */
export function createDecodedAudioBudget() {
  let generation = 0
  let sequence = 0
  let bytes = 0
  let seconds = 0
  let decoding = 0
  const reservations = new Map<number, Reservation>()
  const valid = (cost: AudioCost) => Number.isFinite(cost.bytes) && Number.isFinite(cost.seconds)
    && cost.bytes > 0 && cost.bytes <= MAX_SEGMENT_BYTES && cost.seconds > 0 && cost.seconds <= MAX_SEGMENT_SECONDS
  function reserve(cost: AudioCost): Reservation | undefined {
    if (!valid(cost) || decoding >= MAX_NATIVE_DECODES || bytes + cost.bytes > MAX_QUEUED_BYTES || seconds + cost.seconds > MAX_QUEUED_SECONDS)
      return
    const reservation: Reservation = { ...cost, generation, id: ++sequence, phase: 'decoding' }
    reservations.set(reservation.id, reservation)
    bytes += cost.bytes
    seconds += cost.seconds
    decoding++
    return reservation
  }
  function adjust(reservation: Reservation, actual: AudioCost) {
    if (reservation.generation !== generation || reservations.get(reservation.id) !== reservation || !valid(actual)
      || bytes - reservation.bytes + actual.bytes > MAX_QUEUED_BYTES || seconds - reservation.seconds + actual.seconds > MAX_QUEUED_SECONDS)
      return false
    bytes += actual.bytes - reservation.bytes
    seconds += actual.seconds - reservation.seconds
    reservation.bytes = actual.bytes
    reservation.seconds = actual.seconds
    return true
  }
  function release(reservation: Reservation) {
    // Older non-abortable decodes still own a physical reservation. Identity,
    // rather than the current generation, decides which allocation is released.
    if (reservations.get(reservation.id) !== reservation)
      return
    reservations.delete(reservation.id)
    bytes = Math.max(0, bytes - reservation.bytes)
    seconds = Math.max(0, seconds - reservation.seconds)
    if (reservation.phase === 'decoding')
      decoding--
  }
  function markReady(reservation: Reservation, actual: AudioCost) {
    if (reservation.phase !== 'decoding' || !adjust(reservation, actual))
      return false
    reservation.phase = 'ready'
    decoding--
    return true
  }
  function reset() {
    generation++
    // Native decodeAudioData cannot be aborted. Do not advertise its memory
    // or concurrency slot as free until its promise has actually settled.
    for (const reservation of [...reservations.values()]) {
      if (reservation.phase === 'ready')
        release(reservation)
    }
  }
  return { reserve, adjust, markReady, release, reset, usage: () => ({ bytes, seconds, decoding }) }
}
