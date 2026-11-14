import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const key = () =>
  new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "dev-only-secret-change-me-in-production-32chars"
  );

export async function proxy(req: NextRequest) {
  const token = req.cookies.get("finanzia_session")?.value;
  let ok = false;
  if (token) {
    try {
      await jwtVerify(token, key());
      ok = true;
    } catch {}
  }
  if (!ok) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*"] };
