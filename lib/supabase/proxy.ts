import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isStaticPublicContentRoute =
    pathname === "/apresentacao" ||
    pathname === "/manual" ||
    pathname.startsWith("/manual/");

  if (isStaticPublicContentRoute) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname === "/safisa/login";
  const handlesAuthenticationInRoute =
    pathname === "/api/assistant/chat" ||
    pathname ===
      "/api/assistant/actions/supplier-order-pickup";

  if (!data?.claims && !isPublicRoute && !handlesAuthenticationInRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = pathname.startsWith("/safisa")
      ? "/safisa/login"
      : "/login";
    loginUrl.search = "";

    return NextResponse.redirect(loginUrl);
  }

  return response;
}
