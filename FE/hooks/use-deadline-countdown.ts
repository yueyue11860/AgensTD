import { useEffect, useState } from 'react'
import { reconnectRemainingSeconds } from '../game/network/connection-recovery'

/** 使用绝对服务端 deadline；页面从后台恢复时立即重新校准，不累加本地 interval 漂移。 */
export function useDeadlineCountdown(deadlineAt: number | null): number | null {
  const [remaining, setRemaining] = useState(() => reconnectRemainingSeconds(deadlineAt))

  useEffect(() => {
    const update = () => setRemaining(reconnectRemainingSeconds(deadlineAt))
    update()
    if (deadlineAt === null) return
    const interval = window.setInterval(update, 250)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [deadlineAt])

  return remaining
}
