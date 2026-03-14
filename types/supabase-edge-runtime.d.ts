declare module 'jsr:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js'
}

declare namespace Deno {
  const env: {
    get(name: string): string | undefined
  }

  function serve(handler: (req: Request) => Response | Promise<Response>): void
}