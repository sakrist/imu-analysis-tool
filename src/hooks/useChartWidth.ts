import { useEffect, useState } from 'react'

export function useChartWidth(container: HTMLDivElement | null, fallback = 1000) {
  const [chartWidth, setChartWidth] = useState(fallback)

  useEffect(() => {
    if (!container) return

    const updateWidth = () => {
      setChartWidth(Math.max(320, container.clientWidth - 24))
    }

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(container)
    updateWidth()

    return () => resizeObserver.disconnect()
  }, [container])

  return chartWidth
}
