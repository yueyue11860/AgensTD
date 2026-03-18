import { startTransition, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { resolveApiBaseUrl, resolveGatewayToken } from '../lib/runtime-config'

export type RoomSlotId = 'P1' | 'P2' | 'P3' | 'P4'

export interface RoomPlayerSlot {
  slotId: RoomSlotId
  playerId: string | null
  playerName: string | null
  connected: boolean
  isHost?: boolean
}

export interface RoomSummary {
  id: string
  name: string
  hasPassword: boolean
  players: number
  maxPlayers: number
  status: 'OPEN' | 'IN_MATCH' | 'DRAFTING'
  pingMs: number | null
  slots: RoomPlayerSlot[]
}

interface RoomsResponse {
  ok: boolean
  rooms: RoomSummary[]
}

interface CreateRoomResponse {
  ok: boolean
  room: RoomSummary
}

interface CreateRoomInput {
  name: string
  password: string
}

const ROOM_POLL_INTERVAL_MS = 5000

function createAuthHeaders(token: string | null) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

async function requestJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export function useRoomLobbyData() {
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), [])
  const gatewayToken = useMemo(() => resolveGatewayToken(), [])
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [isLoadingRooms, setIsLoadingRooms] = useState(true)
  const [roomsError, setRoomsError] = useState<string | null>(null)

  const refreshRooms = useEffectEvent(async (signal?: AbortSignal) => {
    if (!apiBaseUrl) {
      setRooms([])
      setRoomsError('未解析到房间 API 地址。')
      setIsLoadingRooms(false)
      return
    }

    try {
      const payload = await requestJson<RoomsResponse>(`${apiBaseUrl}/rooms`, {
        method: 'GET',
        headers: createAuthHeaders(gatewayToken),
        signal,
      })

      startTransition(() => {
        setRooms(payload.rooms ?? [])
      })
      setRoomsError(null)
    }
    catch (requestError) {
      if (signal?.aborted) {
        return
      }

      setRoomsError(requestError instanceof Error ? requestError.message : '读取房间列表失败。')
    }
    finally {
      setIsLoadingRooms(false)
    }
  })

  const createRoom = useEffectEvent(async ({ name, password }: CreateRoomInput) => {
    if (!apiBaseUrl) {
      throw new Error('未解析到房间 API 地址。')
    }

    const payload = await requestJson<CreateRoomResponse>(`${apiBaseUrl}/rooms`, {
      method: 'POST',
      headers: createAuthHeaders(gatewayToken),
      body: JSON.stringify({ name, password }),
    })

    startTransition(() => {
      setRooms((current) => {
        const nextRooms = current.filter((room) => room.id !== payload.room.id)
        return [payload.room, ...nextRooms]
      })
    })
    setRoomsError(null)

    return payload.room
  })

  useEffect(() => {
    const controller = new AbortController()
    void refreshRooms(controller.signal)

    const timer = window.setInterval(() => {
      void refreshRooms()
    }, ROOM_POLL_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [apiBaseUrl, gatewayToken])

  return {
    rooms,
    isLoadingRooms,
    roomsError,
    refreshRooms: () => {
      void refreshRooms()
    },
    createRoom,
  }
}