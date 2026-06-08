import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD ────────────────────────────
// Pro-gated PDF export of events + summaries for the requested date range.
// Returns a downloadable application/pdf response.

export async function GET(req: NextRequest) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Resolve org + plan check ───────────────────────────────────────────
  const { data: member } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .single();

  if (!member) {
    return NextResponse.json({ error: "No org found" }, { status: 404 });
  }

  const { data: org } = await supabase
    .from("orgs")
    .select("plan, name")
    .eq("id", member.org_id)
    .single();

  if (org?.plan !== "pro") {
    return NextResponse.json(
      { error: "PDF export requires a Pro subscription" },
      { status: 403 }
    );
  }

  // ── 3. Parse + validate date range ───────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "Query params 'from' and 'to' are required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const fromDate = new Date(`${fromParam}T00:00:00.000Z`);
  const toDate = new Date(`${toParam}T23:59:59.999Z`);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  if (fromDate > toDate) {
    return NextResponse.json(
      { error: "'from' must be before 'to'" },
      { status: 400 }
    );
  }

  const rangeDays =
    (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > 365) {
    return NextResponse.json(
      { error: "Date range cannot exceed 365 days" },
      { status: 400 }
    );
  }

  // ── 4. Fetch events + summaries ───────────────────────────────────────────
  const { data: eventRows } = await supabase
    .from("events")
    .select(
      "id, is_error, status, occurred_at, action_type, object_type, object_count, target_system, endpoints(label)"
    )
    .eq("org_id", member.org_id)
    .gte("occurred_at", fromDate.toISOString())
    .lte("occurred_at", toDate.toISOString())
    .order("occurred_at", { ascending: true })
    .limit(500); // max events per export

  const { data: summaryRows } = await supabase
    .from("summaries")
    .select("event_id, text")
    .eq("org_id", member.org_id)
    .in(
      "event_id",
      (eventRows ?? []).map((e) => e.id as string)
    );

  const summaryByEventId = new Map(
    (summaryRows ?? []).map((s) => [s.event_id as string, s.text as string])
  );

  const events = eventRows ?? [];

  // ── 5. Build PDF ──────────────────────────────────────────────────────────
  const pdfBytes = await buildPdf({
    orgName: org.name ?? "AutoWatch",
    fromDate,
    toDate,
    events,
    summaryByEventId,
  });

  // ── 6. Return as downloadable PDF ─────────────────────────────────────────
  const filename = `autowatch-export-${fromParam}-to-${toParam}.pdf`;

  return new Response(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ── PDF builder ───────────────────────────────────────────────────────────────

interface EventRow {
  id: unknown;
  is_error: boolean | null;
  status: string;
  occurred_at: string | null;
  action_type: string | null;
  object_type: string | null;
  object_count: number | null;
  target_system: string | null;
  endpoints: { label: string } | null;
}

async function buildPdf({
  orgName,
  fromDate,
  toDate,
  events,
  summaryByEventId,
}: {
  orgName: string;
  fromDate: Date;
  toDate: Date;
  events: EventRow[];
  summaryByEventId: Map<string, string>;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Page dimensions (A4)
  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 48;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // Colors
  const BLACK = rgb(0.067, 0.067, 0.067);
  const GRAY = rgb(0.5, 0.5, 0.5);
  const LIGHT_GRAY = rgb(0.9, 0.9, 0.9);
  const RED = rgb(0.8, 0.15, 0.15);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN + 40) {
      // Add page number to current page
      drawPageFooter();
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function drawPageFooter() {
    const pageNum = pdfDoc.getPageCount();
    page.drawText(`Page ${pageNum}`, {
      x: PAGE_W / 2 - 20,
      y: MARGIN / 2,
      size: 9,
      font: regularFont,
      color: GRAY,
    });
  }

  function drawText(
    text: string,
    x: number,
    size: number,
    font: typeof boldFont,
    color = BLACK,
    maxWidth = CONTENT_W
  ) {
    // Truncate text to fit maxWidth
    let displayText = text;
    while (
      displayText.length > 1 &&
      font.widthOfTextAtSize(displayText, size) > maxWidth
    ) {
      displayText = displayText.slice(0, -4) + "...";
    }
    page.drawText(displayText, { x, y, size, font, color });
  }

  // ── Header ────────────────────────────────────────────────────────────────
  drawText("AutoWatch", MARGIN, 22, boldFont, BLACK);
  y -= 30;
  drawText(`${orgName} — Automation Event Export`, MARGIN, 14, regularFont, GRAY);
  y -= 18;

  const rangeLabel = `${fmt(fromDate)} – ${fmt(toDate)}`;
  drawText(rangeLabel, MARGIN, 11, regularFont, GRAY);
  y -= 8;

  const exportedAt = `Exported ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${events.length} event${events.length !== 1 ? "s" : ""}`;
  drawText(exportedAt, MARGIN, 10, regularFont, GRAY);
  y -= 6;

  // Divider
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: LIGHT_GRAY,
  });
  y -= 20;

  if (events.length === 0) {
    drawText("No events in this date range.", MARGIN, 12, regularFont, GRAY);
    drawPageFooter();
    return pdfDoc.save();
  }

  // ── Column layout ──────────────────────────────────────────────────────────
  // Time | Endpoint | Summary | Status
  const COL_TIME = MARGIN;
  const COL_EP = MARGIN + 78;
  const COL_SUM = MARGIN + 175;
  const COL_STATUS = PAGE_W - MARGIN - 44;

  // Column headers
  const H_SIZE = 9;
  page.drawText("TIME", { x: COL_TIME, y, size: H_SIZE, font: boldFont, color: GRAY });
  page.drawText("AUTOMATION", { x: COL_EP, y, size: H_SIZE, font: boldFont, color: GRAY });
  page.drawText("SUMMARY", { x: COL_SUM, y, size: H_SIZE, font: boldFont, color: GRAY });
  page.drawText("STATUS", { x: COL_STATUS, y, size: H_SIZE, font: boldFont, color: GRAY });
  y -= 4;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: LIGHT_GRAY,
  });
  y -= 14;

  // ── Event rows ─────────────────────────────────────────────────────────────
  const ROW_H = 16;

  for (const ev of events) {
    ensureSpace(ROW_H + 4);

    const timeStr = ev.occurred_at
      ? new Date(ev.occurred_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "—";

    const epLabel = (ev.endpoints as { label: string } | null)?.label ?? "—";

    const summary =
      summaryByEventId.get(ev.id as string) ??
      buildFallbackSummary(ev) ??
      "—";

    const statusLabel = ev.is_error
      ? "Error"
      : ev.status === "summarized"
        ? "OK"
        : ev.status;

    const statusColor = ev.is_error ? RED : ev.status === "summarized" ? rgb(0.1, 0.6, 0.1) : GRAY;

    const ROW_SIZE = 9.5;

    // Time
    page.drawText(timeStr, {
      x: COL_TIME,
      y,
      size: ROW_SIZE,
      font: regularFont,
      color: GRAY,
    });

    // Endpoint (truncated)
    let epDisplay = epLabel;
    const epMaxW = COL_SUM - COL_EP - 8;
    while (
      epDisplay.length > 1 &&
      regularFont.widthOfTextAtSize(epDisplay, ROW_SIZE) > epMaxW
    ) {
      epDisplay = epDisplay.slice(0, -4) + "...";
    }
    page.drawText(epDisplay, {
      x: COL_EP,
      y,
      size: ROW_SIZE,
      font: regularFont,
      color: BLACK,
    });

    // Summary (truncated to fit between ep and status columns)
    let sumDisplay = summary;
    const sumMaxW = COL_STATUS - COL_SUM - 10;
    while (
      sumDisplay.length > 1 &&
      regularFont.widthOfTextAtSize(sumDisplay, ROW_SIZE) > sumMaxW
    ) {
      sumDisplay = sumDisplay.slice(0, -4) + "...";
    }
    page.drawText(sumDisplay, {
      x: COL_SUM,
      y,
      size: ROW_SIZE,
      font: regularFont,
      color: BLACK,
    });

    // Status
    page.drawText(statusLabel, {
      x: COL_STATUS,
      y,
      size: ROW_SIZE,
      font: regularFont,
      color: statusColor,
    });

    y -= ROW_H;

    // Light separator every row
    page.drawLine({
      start: { x: MARGIN, y: y + 3 },
      end: { x: PAGE_W - MARGIN, y: y + 3 },
      thickness: 0.3,
      color: rgb(0.95, 0.95, 0.95),
    });
  }

  // Footer on last page
  drawPageFooter();

  return pdfDoc.save();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildFallbackSummary(ev: EventRow): string | null {
  if (ev.action_type && ev.object_type) {
    const parts = [capitalise(ev.action_type)];
    if (ev.object_count != null) parts.push(String(ev.object_count));
    parts.push(
      ev.object_count === 1 ? ev.object_type : `${ev.object_type}s`
    );
    if (ev.target_system) parts.push(`in ${ev.target_system}`);
    return parts.join(" ");
  }
  return null;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
