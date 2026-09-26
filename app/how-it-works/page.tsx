import type { Metadata } from "next";
import Link from "next/link";
import { eventTypes } from "@/lib/moments";
import { getDict } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.pages.how };
}

export default async function HowItWorks() {
  const { lang, t } = await getDict();
  const types = await eventTypes();
  const ru = lang === "ru";
  return (
    <div className="container section">
      <h1>{t.pages.how}</h1>
      <p className="lead">{t.home.lead}</p>
      <div className="steps" style={{ margin: "32px 0 48px" }}>
        {(ru
          ? [
              ["Выбор и оплата", "Выберите момент, укажите имя получателя, свое имя, поздравление и контакт. Оплата картой, Apple Pay или Google Pay, без регистрации."],
              ["Сертификат", "Сразу после оплаты вы получаете сертификат в PDF и личную ссылку для получателя. Отправьте ее сразу или запланируйте на дату."],
              ["Ожидание", "Получатель видит страницу: «Мы следим за небом». Текущая погода и прогноз на 7 дней."],
              ["Событие", "В ту минуту, когда система фиксирует начало, получателю приходит уведомление. Live-страница: таймер, температура, интенсивность."],
              ["Архив", "После окончания страница становится постоянной записью: даты, время, длительность, интенсивность, ваше имя и поздравление."],
              ["Следующий момент", "Сразу после события открывается следующий такой же момент для нового владельца."],
            ]
          : [
              ["Choose and pay", "Pick a moment, enter the recipient's name, your name, a message and their contact. Pay by card, Apple Pay or Google Pay, no registration."],
              ["Certificate", "Right after payment you get a PDF certificate and a personal link for the recipient. Send it now or schedule it for a date."],
              ["Waiting", "The recipient sees a page that says: we are watching the sky. Current weather and a 7-day forecast."],
              ["The event", "The minute the start is recorded, the recipient is notified. The live page shows a timer, temperature and intensity."],
              ["Archive", "Afterwards the page becomes a permanent record: date, times, duration, intensity, your name and message."],
              ["The next moment", "As soon as the event ends, the next moment of the same kind opens for a new owner."],
            ]
        ).map(([title, text]) => (
          <div className="step" key={title}>
            <h3>{title}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {text}
            </p>
          </div>
        ))}
      </div>

      <h2 id="rules">{t.pages.rules}</h2>
      <p className="muted prose">
        {ru
          ? "Мы опрашиваем погодные данные по каждому городу с активными моментами каждые 5 минут. Начало фиксируется, когда условие выполнено в двух опросах подряд, окончание — когда условие не выполняется 30 минут подряд. Значения на границе порога проверяются по второму независимому источнику; если источники расходятся, решение принимается вручную по данным обоих и публикуется в архиве. Астрономические события рассчитываются по календарю. Все замеры хранятся и доступны в архиве момента."
          : "We poll weather data for every city with active moments every 5 minutes. The start is recorded when the condition is met in two consecutive polls; the end when it has not been met for 30 minutes in a row. Values close to the threshold are checked against a second independent source; if the sources disagree, the decision is made by hand using both and published in the archive. Astronomical events are calculated from the calendar. Every measurement is stored and available in the moment's archive."}
      </p>
      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t.catalog.type}</th>
              <th>{t.moment.rule}</th>
            </tr>
          </thead>
          <tbody>
            {types.map((ty) => (
              <tr key={ty.id}>
                <td style={{ whiteSpace: "nowrap" }}>{ru ? ty.name_ru : ty.name_en}</td>
                <td className="muted">{ru ? ty.rule_ru : ty.rule_en}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link href="/moments" className="btn btn-primary" style={{ marginTop: 32 }}>
        {t.home.cta}
      </Link>
    </div>
  );
}
