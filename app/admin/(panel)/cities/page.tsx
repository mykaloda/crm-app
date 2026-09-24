import { all } from "@/lib/db";
import { eventTypes, listCities, type Offering } from "@/lib/moments";
import { saveCity, saveOffering } from "../../actions";

export default function CitiesAdmin() {
  const cities = listCities(true);
  const types = eventTypes();
  const offerings = all<Offering>("SELECT * FROM offerings ORDER BY event_type_id");
  const typeName = (id: number) => types.find((t) => t.id === id)?.name_en ?? id;

  return (
    <div className="stack">
      <h1 style={{ fontSize: "2rem" }}>Cities &amp; prices</h1>
      {cities.map((c) => (
        <div key={c.id} className="panel">
          <form action={saveCity} className="inline-form">
            <input type="hidden" name="id" value={c.id} />
            <input className="input" name="slug" defaultValue={c.slug} size={10} aria-label="slug" />
            <input className="input" name="name_en" defaultValue={c.name_en} size={10} aria-label="name en" />
            <input className="input" name="name_ru" defaultValue={c.name_ru} size={10} aria-label="name ru" />
            <input className="input" name="in_en" defaultValue={c.in_en} size={12} aria-label="in (en)" />
            <input className="input" name="in_ru" defaultValue={c.in_ru} size={12} aria-label="in (ru)" />
            <input className="input" name="country" defaultValue={c.country} size={3} aria-label="country" />
            <input className="input" name="lat" defaultValue={c.lat} size={8} aria-label="lat" />
            <input className="input" name="lon" defaultValue={c.lon} size={8} aria-label="lon" />
            <input className="input" name="tz" defaultValue={c.tz} size={16} aria-label="time zone" />
            <label className="check">
              <input type="checkbox" name="hidden" defaultChecked={!!c.hidden} /> hidden
            </label>
            <button className="btn btn-ghost btn-small">Save city</button>
          </form>
          <div className="stack" style={{ marginTop: 12 }}>
            {offerings
              .filter((o) => o.city_id === c.id)
              .map((o) => (
                <form key={o.id} action={saveOffering} className="inline-form">
                  <input type="hidden" name="id" value={o.id} />
                  <span style={{ minWidth: 220 }}>{typeName(o.event_type_id)}</span>
                  $<input className="input" name="price" defaultValue={o.price_cents / 100} size={6} aria-label="price" />
                  <select className="input" name="sale_type" defaultValue={o.sale_type} aria-label="sale type">
                    <option value="fixed">fixed</option>
                    <option value="auction">auction</option>
                  </select>
                  <label className="check">
                    <input type="checkbox" name="active" defaultChecked={!!o.active} /> active
                  </label>
                  <button className="btn btn-ghost btn-small">Save price</button>
                </form>
              ))}
            <form action={saveOffering} className="inline-form">
              <input type="hidden" name="city_id" value={c.id} />
              <select className="input" name="event_type_id" aria-label="event type">
                {types
                  .filter((t) => !offerings.some((o) => o.city_id === c.id && o.event_type_id === t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name_en}
                    </option>
                  ))}
              </select>
              $<input className="input" name="price" defaultValue={50} size={6} aria-label="price" />
              <select className="input" name="sale_type" aria-label="sale type">
                <option value="fixed">fixed</option>
                <option value="auction">auction</option>
              </select>
              <button className="btn btn-ghost btn-small">+ Add event to city</button>
            </form>
          </div>
        </div>
      ))}
      <div className="panel">
        <h3>Add city</h3>
        <form action={saveCity} className="inline-form">
          <input className="input" name="slug" placeholder="slug (berlin)" required />
          <input className="input" name="name_en" placeholder="Name (en)" required />
          <input className="input" name="name_ru" placeholder="Название (ru)" required />
          <input className="input" name="in_en" placeholder="in Berlin" />
          <input className="input" name="in_ru" placeholder="в Берлине" />
          <input className="input" name="country" placeholder="DE" size={3} />
          <input className="input" name="lat" placeholder="lat" size={8} required />
          <input className="input" name="lon" placeholder="lon" size={8} required />
          <input className="input" name="tz" placeholder="Europe/Berlin" required />
          <button className="btn btn-primary btn-small">Add city</button>
        </form>
      </div>
    </div>
  );
}
