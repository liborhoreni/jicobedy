import Head from "next/head";
import { useState, useEffect } from "react";
import styles from "@/styles/Home.module.css";

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

function MenuGroup({ label, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={styles.menuGroup}>
      <div className={styles.menuGroupLabel}>{label}</div>
      {items.map((item, i) => (
        <div key={i} className={styles.menuItem}>
          <span className={styles.menuItemName}>{item.name}</span>
          <span className={styles.menuItemPrice}>{item.price}</span>
        </div>
      ))}
    </div>
  );
}

function RestaurantCard({ r }) {
  const hasMenu = r.menu && (
    (r.menu.soups && r.menu.soups.length > 0) ||
    (r.menu.meals && r.menu.meals.length > 0) ||
    (r.menu.weekly && r.menu.weekly.length > 0)
  );

  return (
    <div className={styles.restaurant}>
      <div className={styles.restaurantHeader}>
        {r.logo && <img className={styles.restaurantLogo} src={r.logo} alt={r.name} />}
        <span className={styles.restaurantName}>{r.name}</span>
        <a className={styles.restaurantLink} href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
          zdroj →
        </a>
      </div>

      {!hasMenu ? (
        <div className={styles.closedMessage}>{r.note || 'Menu zatím není k dispozici'}</div>
      ) : (
        <div className={styles.menuSection}>
          <MenuGroup label="Polévky" items={r.menu.soups} />
          <MenuGroup label="Hlavní jídla" items={r.menu.meals} />
          <MenuGroup label="Týdenní nabídka" items={r.menu.weekly} />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [spinning, setSpinning] = useState(false);

  const now = new Date();
  const dateStr = `${DAYS[now.getDay()]} ${now.getDate()}. ${MONTHS[now.getMonth()]}`;

  useEffect(() => {
    fetch('/api/menus').then(r => r.json()).then(setData).catch(console.error);
  }, []);

  async function handleRefresh() {
    setSpinning(true);
    try {
      await fetch('/api/scrape', { method: 'POST' });
      const res = await fetch('/api/menus');
      setData(await res.json());
    } catch (err) {
      console.error(err);
    }
    setSpinning(false);
  }

  return (
    <>
      <Head>
        <title>JIC Obědy</title>
        <meta name="description" content="Denní menu restaurací v okolí JIC Brno" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1 className={styles.title}>JIC Obědy</h1>
          <div className={styles.headerRight}>
            <span className={styles.date}>{dateStr}</span>
            <button
              className={`${styles.refreshBtn} ${spinning ? styles.spinning : ''}`}
              onClick={handleRefresh}
              title="Obnovit data"
            >
              ↻
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {!data || !data.restaurants || data.restaurants.length === 0 ? (
          <div className={styles.loading}>Načítám menu...</div>
        ) : (
          data.restaurants.map(r => <RestaurantCard key={r.id} r={r} />)
        )}
      </main>

      <footer className={styles.footer}>
        <p>Data z <a href="https://www.menicka.cz" target="_blank" rel="noopener noreferrer">menicka.cz</a> a webů restaurací</p>
      </footer>
    </>
  );
}
