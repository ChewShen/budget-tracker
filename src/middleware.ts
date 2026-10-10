import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";
import { GUEST_COOKIE } from "@/lib/guest";

// Refreshes the Supabase session cookie and sends signed-out visitors to /login.
// This is a convenience layer only: the data itself is protected by RLS policies
// (scripts/secure_rls.sql), which is what actually keeps other people out.
export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/login";
  // Guests ("Try the demo") only ever see in-memory demo data; RLS still
  // blocks them from the database, so letting them past this redirect exposes nothing.
  const isGuest = request.cookies.get(GUEST_COOKIE)?.value === "1";

  // API routes check auth themselves (the reminders cron has no user session, only CRON_SECRET).
  const isApi = request.nextUrl.pathname.startsWith("/api/");

  if (!user && !isLoginPage && !isGuest && !isApi) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  // Signed in for real: drop any leftover guest flag so the app loads the account's data.
  if (user && isGuest) response.cookies.delete(GUEST_COOKIE);

  return response;
}

export const config = {
  // Skip Next internals and public static files (manifest, service worker, icons).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:png|svg|ico|webp)$).*)"],
};
