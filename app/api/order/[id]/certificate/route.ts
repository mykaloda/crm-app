import { certificatePdf } from "@/lib/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pdf = await certificatePdf(id);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="moment-${id}.pdf"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
