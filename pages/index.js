import Head from "next/head";
import { useState, useEffect } from "react";
import confetti from "canvas-confetti";
import styles from "@/styles/Home.module.css";

const RESTAURANT_COLORS = {
  '8518': '#e74c3c',
  '4931': '#3498db',
  'bistro22': '#2ecc71',
  'qwerty': '#f39c12',
  '3884': '#9b59b6',
};

function stripNumber(name) {
  return name.replace(/^\d+\.\s*/, '');
}

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
          <span className={styles.menuItemName}>
            {stripNumber(item.name)}
            {item.veggie && <img className={styles.veggieBadge} src="/vegetarian.png" alt="V" title="Vegetariánské" />}
            {item.spicy && <span className={styles.spicyBadge} title="Pikantní">🌶️</span>}
          </span>
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
    <div className={styles.restaurant} style={{ borderLeftColor: RESTAURANT_COLORS[r.id] || '#a8a29e' }}>
      <div className={styles.restaurantHeader}>
        <span className={styles.restaurantName}>{r.name}</span>
      </div>

      {!hasMenu ? (
        <div className={styles.closedMessage}>{r.note || 'Menu zatím není k dispozici'}</div>
      ) : (
        <div className={styles.menuSection}>
          <MenuGroup label={r.menu.soups && r.menu.soups.length === 1 ? "Polévka" : "Polévky"} items={r.menu.soups} />
          <MenuGroup label="Denní menu" items={r.menu.meals} />
          <MenuGroup label="Týdenní nabídka" items={r.menu.weekly} />
        </div>
      )}
    </div>
  );
}

const RANDOM_MESSAGES = [
  'Dneska zkus tohle!',
  'Na tohle máš chuť, věř mi.',
  'Osud promluvil!',
  'Výběr pro tebe:',
  'Hvězdy praví...',
];

export default function Home() {
  const [data, setData] = useState(null);
  const [randomPick, setRandomPick] = useState(null);
  const now = new Date();
  const dateStr = `${DAYS[now.getDay()]} ${now.getDate()}. ${MONTHS[now.getMonth()]}`;

  useEffect(() => {
    fetch('/api/menus').then(r => r.json()).then(setData).catch(console.error);
  }, []);

  function pickRandom() {
    if (!data || !data.restaurants) return;
    const allMeals = [];
    for (const r of data.restaurants) {
      if (!r.menu) continue;
      for (const item of (r.menu.meals || [])) {
        allMeals.push({ meal: item, restaurant: r.name });
      }
      if (r.id === 'qwerty') {
        for (const item of (r.menu.weekly || [])) {
          allMeals.push({ meal: item, restaurant: r.name });
        }
      }
    }
    if (allMeals.length === 0) return;
    const pick = allMeals[Math.floor(Math.random() * allMeals.length)];
    const msg = RANDOM_MESSAGES[Math.floor(Math.random() * RANDOM_MESSAGES.length)];
    setRandomPick({ ...pick, message: msg });
    confetti({
      particleCount: 35,
      spread: 55,
      startVelocity: 35,
      ticks: 90,
      origin: { x: 0.5, y: 0.6 },
      colors: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#d97706'],
    });
  }

  return (
    <>
      <Head>
        <title>Obědy v okolí JIC</title>
        <meta name="description" content="Denní menu restaurací v okolí JIC Brno" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerTop}>
            <h1 className={styles.title}>Obědy v okolí <img className={styles.jicLogo} src="/jic.png" alt="JIC" /></h1>
            {data && data.restaurants && data.restaurants.length > 0 && (
              <button className={styles.randomBtn} onClick={pickRandom}>
                🎲 Náhodné jídlo
              </button>
            )}
          </div>
          <span className={styles.date}>{dateStr}</span>
        </div>
      </header>

      {randomPick && (
        <div className={styles.randomResult}>
          <div className={styles.randomMessage}>{randomPick.message}</div>
          <div className={styles.randomMeal}>{stripNumber(randomPick.meal.name)}</div>
          <div className={styles.randomRestaurant}>{randomPick.restaurant} {randomPick.meal.price && `· ${randomPick.meal.price}`}</div>
        </div>
      )}

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
