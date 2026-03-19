import { io } from '../FE/node_modules/socket.io-client/build/esm-debug/index.js'

const apiBase = 'http://192.168.50.78:3000/api'

const createRes = await fetch(`${apiBase}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'lan-test', password: '' }),
})
const created = await createRes.json()
const roomId = created.room.id
console.log('CREATED', roomId)

function connectPlayer(playerId, playerName) {
  return new Promise((resolve, reject) => {
    const socket = io('http://192.168.50.78:3000', {
      transports: ['websocket'],
      query: { roomId, playerId, playerName, playerKind: 'human' },
      timeout: 5000,
    })

    socket.on('connect_error', (error) => {
      reject(error)
    })

    socket.on('connect', () => {
      socket.emit('JOIN_ROOM', { roomId, playerId, playerName, playerKind: 'human' })
    })

    socket.on('ROOM_JOINED', (payload) => {
      console.log(playerId, 'ROOM_JOINED', JSON.stringify(payload))
      resolve({ socket, payload })
    })
  })
}

const alice = await connectPlayer('alice', 'Alice')
const bob = await connectPlayer('bob', 'Bob')

const roomsRes = await fetch(`${apiBase}/rooms`)
const rooms = await roomsRes.json()
console.log('ROOMS', JSON.stringify(rooms.rooms.find((room) => room.id === roomId), null, 2))

alice.socket.close()
bob.socket.close()
