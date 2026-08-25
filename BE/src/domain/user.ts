/** 由 Supabase Auth 身份同步出的应用用户资料。 */
export interface AppUser {
  userId: string
  name: string
  email: string
  avatar: string
  bio: string
  route: string
}
