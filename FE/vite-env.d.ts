/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_WS_URL?: string
	readonly VITE_GATEWAY_TOKEN?: string
	readonly VITE_API_BASE_URL?: string
	readonly VITE_PLAYER_ID?: string
	readonly VITE_PLAYER_NAME?: string
	readonly VITE_PLAYER_KIND?: string
	readonly VITE_SUPABASE_URL?: string
	readonly VITE_SUPABASE_ANON_KEY?: string
	/** 仅 `vite dev` 有效；设为 false 可关闭无数据库本地测试账号。 */
	readonly VITE_LOCAL_TEST_AUTH?: string
	readonly VITE_LOCAL_TEST_EMAIL?: string
	readonly VITE_LOCAL_TEST_PASSWORD?: string
	/** 仅 `vite dev` 有效；生产构建即使设置也不能绕过 RequireAuth。 */
	readonly VITE_AUTH_BYPASS?: string
	/** 竞技技术预览开关；生产默认不开放排位入口。 */
	readonly VITE_PVP_RANKED_ENABLED?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
