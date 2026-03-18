/** SecondMe OAuth 用户信息 */
export interface SecondMeUser {
  userId: string
  name: string
  email: string
  avatar: string
  bio: string
  route: string
}

/** 存储在内存中的用户会话 */
export interface UserSession {
  sessionToken: string
  user: SecondMeUser
  accessToken: string
  refreshToken: string
  expiresAt: number
}
