import { all, run } from "./db";
import { dictionaries, fmt, type Lang } from "./i18n";
import { siteUrl } from "./request";

/**
 * Outbox for all outgoing messages. Everything is written to the
 * `notifications` table first and then delivered: email via Resend, SMS via
 * Twilio. Without provider keys messages are only logged (visible in the admin
 * panel), which keeps development and demos safe.
 */

export type Channel = "email" | "sms" | "push";

export function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
export function isPhone(s: string) {
  return /^\+?[0-9\s\-()]{7,20}$/.test(s.trim()) && s.replace(/\D/g, "").length >= 7;
}

export function queue(opts: {
  channel: Channel;
  to: string;
  subject?: string;
  body: string;
  kind: string;
  orderId?: string;
}) {
  run(
    `INSERT INTO notifications(channel, recipient, subject, body, kind, order_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    opts.channel,
    opts.to,
    opts.subject ?? null,
    opts.body,
    opts.kind,
    opts.orderId ?? null,
    Date.now(),
  );
}

interface Pending {
  id: number;
  channel: Channel;
  recipient: string;
  subject: string | null;
  body: string;
  kind: string;
  order_id: string | null;
}

let flushing = false;

export async function flushNotifications() {
  if (flushing) return;
  flushing = true;
  try {
    const pending = all<Pending>("SELECT * FROM notifications WHERE status = 'queued' ORDER BY id LIMIT 50");
    for (const n of pending) {
      try {
        const delivered = await deliver(n);
        run("UPDATE notifications SET status = ?, error = NULL WHERE id = ?", delivered ? "sent" : "logged", n.id);
      } catch (e) {
        run("UPDATE notifications SET status = 'failed', error = ? WHERE id = ?", String(e).slice(0, 500), n.id);
      }
    }
  } finally {
    flushing = false;
  }
}

async function deliver(n: Pending): Promise<boolean> {
  if (n.channel === "email") {
    const key = process.env.RESEND_API_KEY;
    if (!key) return false;
    const attachments: { filename: string; content: string }[] = [];
    if (n.kind === "certificate" && n.order_id) {
      const { certificatePdf } = await import("./pdf");
      const pdf = await certificatePdf(n.order_id);
      if (pdf) attachments.push({ filename: `moment-${n.order_id}.pdf`, content: Buffer.from(pdf).toString("base64") });
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Moment <hello@example.com>",
        to: [n.recipient],
        subject: n.subject ?? "Moment",
        html: emailHtml(n.body),
        text: n.body,
        attachments,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return true;
  }
  if (n.channel === "sms") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) return false;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: n.recipient.replace(/[^\d+]/g, ""), From: from, Body: n.body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    return true;
  }
  // Web push is optional in the MVP: logged only.
  return false;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function emailHtml(body: string) {
  const html = escapeHtml(body)
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#f2c46d">$1</a>')
    .replace(/\n/g, "<br>");
  return `<div style="background:#0d1020;padding:32px;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#151a2e;border-radius:16px;padding:32px;color:#eef0f7;font-size:16px;line-height:1.6">
    <div style="font-family:Georgia,serif;font-size:22px;color:#f2c46d;margin-bottom:16px">Moment</div>${html}
  </div></div>`;
}

// ---------------------------------------------------------------- templates

const T = {
  en: {
    certificateSubject: "Your certificate: {title}",
    certificate:
      "Thank you! {title} is now a gift for {recipient}.\n\nOrder {order}. Your certificate is attached and available here:\n{orderUrl}\n\nThe recipient's page:\n{link}",
    giftSubject: "{giver} has given you a moment",
    gift: "{recipient}, {giver} has given you {titleLower}.\n\nIt is yours alone. We are watching the sky and will tell you the minute it begins:\n{link}",
    giftSms: "{recipient}, {giver} gave you {titleLower}. Follow it here: {link}",
    startedSubject: "It has begun",
    started: "{text}\n\nWatch it live:\n{link}",
    buyerStartedSubject: "The moment you gave has begun",
    buyerStarted: "{title} has just begun. {recipient} has been notified.\n{link}",
    endedSubject: "Your moment is now in your archive",
    ended: "{title} has ended. It lasted {duration}.\n\nIt will stay in your archive forever:\n{link}",
    loginSubject: "Your sign-in code",
    login: "Your code: {code}\nIt is valid for 15 minutes.",
    outbidSubject: "You have been outbid",
    outbid: "Someone placed a higher bid ({amount}) on {title}.\n{link}",
    wonSubject: "You won the auction",
    won: "You won {title} for {amount}. Please pay within 24 hours:\n{link}",
    reminderSubject: "Reminder: pay for your auction win",
    reminder: "You have a few hours left to pay for {title}:\n{link}",
  },
  ru: {
    certificateSubject: "Ваш сертификат: {title}",
    certificate:
      "Спасибо! {title} теперь подарок для получателя: {recipient}.\n\nЗаказ {order}. Сертификат во вложении и по ссылке:\n{orderUrl}\n\nСтраница получателя:\n{link}",
    giftSubject: "{giver} дарит вам момент",
    gift: "{recipient}, {giver} дарит вам: {titleLower}.\n\nОн принадлежит только вам. Мы следим за небом и сообщим, как только он начнется:\n{link}",
    giftSms: "{recipient}, {giver} дарит вам: {titleLower}. Следите здесь: {link}",
    startedSubject: "Началось",
    started: "{text}\n\nСмотрите в реальном времени:\n{link}",
    buyerStartedSubject: "Подаренный вами момент начался",
    buyerStarted: "{title}: началось. Получатель ({recipient}) уже знает.\n{link}",
    endedSubject: "Ваш момент теперь в архиве",
    ended: "{title}: завершилось. Длительность: {duration}.\n\nОн навсегда останется в вашем архиве:\n{link}",
    loginSubject: "Код для входа",
    login: "Ваш код: {code}\nОн действует 15 минут.",
    outbidSubject: "Вашу ставку перебили",
    outbid: "Кто-то сделал ставку выше ({amount}) на лот «{title}».\n{link}",
    wonSubject: "Вы выиграли аукцион",
    won: "Вы выиграли лот «{title}» за {amount}. Оплатите в течение 24 часов:\n{link}",
    reminderSubject: "Напоминание об оплате аукциона",
    reminder: "Осталось несколько часов, чтобы оплатить лот «{title}»:\n{link}",
  },
};

type TemplateKey = keyof (typeof T)["en"];

export function tpl(lang: Lang, key: TemplateKey, vars: Record<string, string | number>) {
  return fmt(T[lang][key], vars);
}

export function link(path: string) {
  return `${siteUrl()}${path}`;
}

export function giverOrDefault(name: string | null | undefined, lang: Lang) {
  return name?.trim() || (lang === "ru" ? "Кто-то близкий" : "Someone who cares");
}

export { dictionaries };
