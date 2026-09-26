import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { getOrder } from "./orders";
import { getMoment, momentTitle } from "./moments";
import { link, giverOrDefault } from "./notify";
import { formatDateTime } from "./time";

const fontDir = path.join(process.cwd(), "assets", "fonts");

export async function loadFont(name: string) {
  return fs.readFile(path.join(fontDir, name));
}

const GOLD = rgb(0.949, 0.769, 0.427);
const INK = rgb(0.933, 0.941, 0.969);
const MUTED = rgb(0.604, 0.639, 0.741);
const NIGHT = rgb(0.051, 0.063, 0.125);

function centered(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = INK) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, size, font, color });
}

function fit(text: string, font: PDFFont, size: number, max: number) {
  let s = size;
  while (s > 10 && font.widthOfTextAtSize(text, s) > max) s -= 1;
  return s;
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Branded A4 landscape certificate for an order. */
export async function certificatePdf(orderId: string): Promise<Uint8Array | null> {
  const order = await getOrder(orderId);
  if (!order || order.status !== "paid") return null;
  const moment = (await getMoment(order.moment_id))!;
  const lang = order.lang;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const serif = await doc.embedFont(await loadFont("Cormorant-SemiBold.ttf"), { subset: true });
  const sans = await doc.embedFont(await loadFont("Inter-Regular.ttf"), { subset: true });
  doc.setTitle(`${momentTitle(moment, lang)} · ${order.recipient_name}`);
  doc.setAuthor("Moment");

  const page = doc.addPage([842, 595]);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width, height, color: NIGHT });
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: GOLD, borderWidth: 1 });
  page.drawRectangle({ x: 30, y: 30, width: width - 60, height: height - 60, borderColor: GOLD, borderWidth: 0.4, opacity: 0 });

  // A few stars.
  for (let i = 0; i < 40; i++) {
    const x = 40 + ((i * 197) % (width - 80));
    const y = 40 + ((i * 131) % (height - 80));
    page.drawCircle({ x, y, size: (i % 3) * 0.4 + 0.4, color: INK, opacity: 0.35 });
  }

  const ru = lang === "ru";
  centered(page, ru ? "СЕРТИФИКАТ МОМЕНТА" : "MOMENT CERTIFICATE", sans, 11, height - 88, GOLD);
  const title = momentTitle(moment, lang);
  centered(page, title, serif, fit(title, serif, 40, width - 140), height - 160);
  centered(page, ru ? "для" : "for", sans, 13, height - 205, MUTED);
  centered(page, order.recipient_name, serif, fit(order.recipient_name, serif, 54, width - 160), height - 265, GOLD);

  let y = height - 315;
  if (order.message && !order.hide_message) {
    for (const line of wrap(`«${order.message}»`, serif, 18, width - 220).slice(0, 4)) {
      centered(page, line, serif, 18, y);
      y -= 24;
    }
  }
  centered(page, (ru ? "От: " : "From ") + giverOrDefault(order.giver_name, lang), sans, 12, y - 8, MUTED);

  const rule = ru ? moment.type.rule_ru : moment.type.rule_en;
  const ruleLines = wrap(rule, sans, 9, width - 200);
  let ry = 130;
  for (const line of ruleLines.slice(0, 2)) {
    centered(page, line, sans, 9, ry, MUTED);
    ry -= 13;
  }

  const url = link(`/m/${order.token}`);
  centered(page, url, sans, fit(url, sans, 9, width - 120), 84, GOLD);
  const issued = formatDateTime(order.paid_at ?? Date.now(), moment.city.tz, lang, false);
  centered(page, `${ru ? "Заказ" : "Order"} ${order.id} · ${issued}`, sans, 9, 66, MUTED);

  return doc.save();
}
