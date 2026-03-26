const QUICKTIME_EPOCH_OFFSET_SEC = 2082844800

function readUInt32(view: DataView, offset: number) {
  return view.getUint32(offset, false)
}

function readUInt64(view: DataView, offset: number) {
  const high = view.getUint32(offset, false)
  const low = view.getUint32(offset + 4, false)
  return high * 2 ** 32 + low
}

function readType(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function parseCreationTimeFromMvhd(view: DataView, start: number, size: number) {
  if (size < 20) return null

  const version = view.getUint8(start)
  const creationTime = version === 1 ? readUInt64(view, start + 4) : readUInt32(view, start + 4)
  const unixTimestamp = creationTime - QUICKTIME_EPOCH_OFFSET_SEC
  return Number.isFinite(unixTimestamp) && unixTimestamp > 0 ? unixTimestamp : null
}

function findBox(view: DataView, targetType: string, start = 0, end = view.byteLength): { start: number; size: number } | null {
  let offset = start

  while (offset + 8 <= end) {
    let size = readUInt32(view, offset)
    const type = readType(view, offset + 4)
    let headerSize = 8

    if (size === 1) {
      if (offset + 16 > end) return null
      size = readUInt64(view, offset + 8)
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }

    if (size < headerSize || offset + size > end) return null

    if (type === targetType) {
      return { start: offset + headerSize, size: size - headerSize }
    }

    if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'meta') {
      const childStart = type === 'meta' ? offset + headerSize + 4 : offset + headerSize
      const child = findBox(view, targetType, childStart, offset + size)
      if (child) return child
    }

    offset += size
  }

  return null
}

export async function extractVideoCreationTimestamp(file: File) {
  const normalizedName = file.name.toLowerCase()
  if (!normalizedName.endsWith('.mp4') && !normalizedName.endsWith('.mov') && file.type !== 'video/mp4' && file.type !== 'video/quicktime') {
    return null
  }

  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const mvhd = findBox(view, 'mvhd')
  if (!mvhd) return null
  return parseCreationTimeFromMvhd(view, mvhd.start, mvhd.size)
}
