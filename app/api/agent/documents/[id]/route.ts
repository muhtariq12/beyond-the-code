import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/agent/runtime";

/** Authenticated (middleware) download or inline preview of a private document. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^doc_[0-9a-f]{16}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getCtx();
  const meta = await ctx.store.get("documents", id);
  const bytes = meta && (await ctx.blobs.get(id));
  if (!meta || !bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const inline = req.nextUrl.searchParams.get("inline") === "1" && meta.mime === "application/pdf";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": meta.mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${meta.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
