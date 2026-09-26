import type { Metadata } from "next";
import { getDict } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.pages.privacy };
}

const EN = [
  ["What we collect", "Buyer: email, name (optional), order details. Recipient: name and email or phone number entered by the buyer. Payment data is handled by Stripe and never reaches our servers."],
  ["Why", "To deliver the gift, send notifications about the event, issue certificates and receipts, and prevent fraud."],
  ["Processors", "Stripe (payments, taxes), Resend (email), Twilio (SMS), weather providers (they receive only city coordinates), analytics (Google Analytics, Meta Pixel) if you accept them."],
  ["Retention", "Weather measurements are kept for at least 3 years. Archive pages are kept indefinitely unless the recipient deletes them. Orders are kept as long as required by tax law."],
  ["Recipient's rights", "The recipient can change how they are notified, unsubscribe or delete the record and their contact on their moment page at any time."],
  ["Your rights", "You can request access, correction or deletion of your data by email. Account sign-in uses one-time codes; we do not store passwords."],
];
const RU = [
  ["Что мы собираем", "Покупатель: email, имя (по желанию), данные заказа. Получатель: имя и email или телефон, которые ввел покупатель. Платежные данные обрабатывает Stripe, они не попадают на наши серверы."],
  ["Зачем", "Чтобы доставить подарок, уведомить о событии, выдать сертификат и чек и предотвращать мошенничество."],
  ["Обработчики", "Stripe (платежи, налоги), Resend (email), Twilio (SMS), погодные сервисы (получают только координаты города), аналитика (Google Analytics, Meta Pixel), если вы ее принимаете."],
  ["Сроки хранения", "Погодные замеры хранятся не менее 3 лет. Архивные страницы хранятся бессрочно, если получатель их не удалит. Заказы хранятся столько, сколько требует налоговое законодательство."],
  ["Права получателя", "Получатель может изменить способ уведомления, отписаться или удалить запись и свой контакт на своей странице момента в любое время."],
  ["Ваши права", "Вы можете запросить доступ к своим данным, их исправление или удаление по email. Вход в кабинет — по одноразовому коду, пароли мы не храним."],
];

export default async function PrivacyPage() {
  const { lang, t } = await getDict();
  return (
    <div className="container section">
      <div className="prose">
        <h1>{t.pages.privacy}</h1>
        {(lang === "ru" ? RU : EN).map(([h, p]) => (
          <section key={h}>
            <h2>{h}</h2>
            <p>{p}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
