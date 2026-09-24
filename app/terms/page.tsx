import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.pages.terms };
}

const EN: [string, string[]][] = [
  ["1. The service", [
    "Moment sells a digital gift: a named link between a recipient and a natural event (for example, the next rain) in a specific city, real-time tracking of that event, notifications and a permanent record in the recipient's archive.",
    "The buyer does not acquire any right to, ownership of, or control over a natural phenomenon. Moment does not cause, forecast with certainty or guarantee any weather.",
  ]],
  ["2. Uniqueness", [
    "Each moment in each city is sold to one buyer only. After purchase it is removed from the catalog until the event happens, after which the next moment of the same kind may be offered.",
  ]],
  ["3. How events are recorded", [
    "The start and end of an event are determined by the rules published on the moment page and on the How it works page (thresholds, duration, season), using weather data providers (currently OpenWeatherMap and Open-Meteo) or astronomical calculations.",
    "The start is recorded when the condition is met in two consecutive polls, five minutes apart. The end is recorded when the condition has not been met for 30 minutes.",
    "Borderline values are checked against a second data source. Where sources disagree, Moment decides based on the data of both sources and publishes the decision and all measurements in the moment's archive. Claims about a disputed recording are accepted within 14 days after the event.",
  ]],
  ["4. No deadline", [
    "Moments have no expiry date. If the event does not happen within any period of time (for example, rain in Dubai), we continue monitoring until it does. Window events (such as rain on New Year's Eve) carry over to the next year's window if the event does not happen within it.",
  ]],
  ["5. Price, payment and taxes", [
    "Prices are in US dollars and include payment processing fees. Other currencies are shown for reference only. Payment is processed by Stripe; Moment never stores card data. VAT or sales tax is calculated according to the buyer's country.",
  ]],
  ["6. Refunds", [
    "A refund can be requested at any time before the event starts, in the account or by email. The amount refunded is the price paid minus payment processing fees. After the event has started, the service is considered delivered and is not refundable.",
  ]],
  ["7. Recipient's data", [
    "The buyer enters the recipient's name and contact and confirms that they have the recipient's consent to do so. The recipient may choose how to be notified, unsubscribe, or delete the record and their contact at any time from their moment page.",
  ]],
  ["8. Auctions", [
    "Only registered users with a card on file may bid. Bids are binding. A bid in the last five minutes extends the auction by five minutes. The winner must pay within 24 hours; otherwise the lot passes to the next highest bidder and the winner may be banned from auctions.",
    "Bidding on your own lots or through several accounts to raise the price is prohibited and leads to cancellation of the bids.",
  ]],
  ["9. Liability", [
    "Moment is responsible for correctly applying the published rules to the data received from providers. Moment is not liable for inaccuracies in third-party data beyond the dispute procedure in section 3.",
  ]],
];

const RU: [string, string[]][] = [
  ["1. Услуга", [
    "Moment продает цифровой подарок: именную привязку получателя к природному событию (например, следующему дождю) в конкретном городе, отслеживание этого события в реальном времени, уведомления и постоянную запись в архиве получателя.",
    "Покупатель не приобретает прав на природное явление, права собственности на него или контроля над ним. Moment не вызывает погоду, не гарантирует ее и не предсказывает ее с достоверностью.",
  ]],
  ["2. Уникальность", [
    "Каждый момент в каждом городе продается только одному покупателю. После покупки он убирается из каталога до наступления события, после чего может быть предложен следующий такой же момент.",
  ]],
  ["3. Правила фиксации событий", [
    "Начало и окончание события определяются по правилам, опубликованным на странице момента и на странице «Как это работает» (пороги, длительность, сезон), на основании данных погодных сервисов (сейчас OpenWeatherMap и Open-Meteo) или астрономического расчета.",
    "Начало фиксируется, когда условие выполнено в двух опросах подряд с интервалом пять минут. Окончание — когда условие не выполняется 30 минут.",
    "Значения на границе порога проверяются по второму источнику. Если источники расходятся, Moment принимает решение по данным обоих источников и публикует решение и все замеры в архиве момента. Претензии по спорной фиксации принимаются в течение 14 дней после события.",
  ]],
  ["4. Без срока", [
    "У моментов нет срока. Если событие не наступает в течение любого времени (например, дождь в Дубае), мы продолжаем наблюдение, пока оно не наступит. События с окном (например, дождь на Новый год) переносятся на окно следующего года, если событие в него не наступило.",
  ]],
  ["5. Цена, оплата и налоги", [
    "Цены указаны в долларах США и включают комиссии платежной системы. Другие валюты показаны справочно. Платежи обрабатывает Stripe; Moment не хранит данные карт. НДС или налог с продаж рассчитывается по стране покупателя.",
  ]],
  ["6. Возврат", [
    "Возврат можно запросить в любой момент до начала события в кабинете или по email. Возвращается уплаченная сумма за вычетом комиссий платежной системы. После начала события услуга считается оказанной, возврат не производится.",
  ]],
  ["7. Данные получателя", [
    "Покупатель вводит имя и контакт получателя и подтверждает, что имеет его согласие на это. Получатель может выбрать способ уведомления, отписаться, удалить запись и свой контакт в любой момент на своей странице момента.",
  ]],
  ["8. Аукционы", [
    "Ставки могут делать только зарегистрированные пользователи с привязанной картой. Ставка обязательна к исполнению. Ставка в последние пять минут продлевает аукцион на пять минут. Победитель оплачивает в течение 24 часов; иначе лот переходит следующему участнику, а победитель может быть лишен доступа к аукционам.",
    "Ставки на собственные лоты или с нескольких аккаунтов для повышения цены запрещены и аннулируются.",
  ]],
  ["9. Ответственность", [
    "Moment отвечает за корректное применение опубликованных правил к данным, полученным от поставщиков. Moment не несет ответственности за неточности сторонних данных сверх порядка разрешения споров из раздела 3.",
  ]],
];

export default async function TermsPage() {
  const { lang, t } = await getDict();
  const sections = lang === "ru" ? RU : EN;
  return (
    <div className="container section">
      <div className="prose">
        <h1>{t.pages.terms}</h1>
        <p className="notice notice-gold">
          {lang === "ru"
            ? "Черновик оферты. Перед запуском текст должен проверить юрист."
            : "Draft terms. Must be reviewed by a lawyer before launch."}
        </p>
        {sections.map(([title, paragraphs]) => (
          <section key={title}>
            <h2>{title}</h2>
            {paragraphs.map((p) => (
              <p key={p.slice(0, 32)}>{p}</p>
            ))}
          </section>
        ))}
        <p>
          <Link href="/how-it-works#rules" className="link">
            {t.pages.rules} →
          </Link>
        </p>
      </div>
    </div>
  );
}
