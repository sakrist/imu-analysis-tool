import { useCallback, useEffect, useState } from 'react'

export type ObjectUrlFile = {
  name: string
  url: string
}

export function useObjectUrlFile() {
  const [fileRef, setFileRef] = useState<ObjectUrlFile | null>(null)

  const clear = useCallback(() => {
    setFileRef((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  const setFromFile = useCallback((file: File | null | undefined) => {
    if (!file) return
    setFileRef((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return { name: file.name, url: URL.createObjectURL(file) }
    })
  }, [])

  useEffect(() => {
    return () => {
      if (fileRef?.url) URL.revokeObjectURL(fileRef.url)
    }
  }, [fileRef])

  return { fileRef, clear, setFromFile }
}
