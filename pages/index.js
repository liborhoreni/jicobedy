import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
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

function normalize(name) {
  return stripNumber(name).toLowerCase().trim().replace(/\s+/g, ' ');
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem('favorites') || '[]');
    // Migrate old format (plain strings) to new format ({name, addedAt})
    return raw.map(f => typeof f === 'string' ? { name: f, addedAt: '2000-01-01' } : f);
  } catch { return []; }
}

function saveFavorites(favs) {
  localStorage.setItem('favorites', JSON.stringify(favs));
}

function getHiddenRestaurants() {
  try {
    return JSON.parse(localStorage.getItem('hiddenRestaurants') || '[]');
  } catch { return []; }
}

function saveHiddenRestaurants(ids) {
  localStorage.setItem('hiddenRestaurants', JSON.stringify(ids));
}

function isFavorite(name, favs) {
  const n = normalize(name);
  return favs.some(f => normalize(f.name) === n);
}

function isOldFavorite(name, favs) {
  const n = normalize(name);
  const today = getToday();
  return favs.some(f => normalize(f.name) === n && f.addedAt !== today);
}

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

function MenuGroup({ label, items, favorites, onToggleFav }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={styles.menuGroup}>
      <div className={styles.menuGroupLabel}>{label}</div>
      {items.map((item, i) => {
        const fav = isFavorite(item.name, favorites);
        return (
          <div key={i} className={styles.menuItem}>
            <button
              className={styles.favBtn}
              onClick={() => onToggleFav(item.name)}
              title={fav ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
            >
              {fav ? '❤️' : <svg className={styles.heartEmpty} viewBox="1 2 22 20" width="14" height="14"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="#d6d3d1" strokeWidth="1.5"/></svg>}
            </button>
            <span className={styles.menuItemName}>
              {stripNumber(item.name)}
              {item.veggie && <img className={styles.veggieBadge} src="/vegetarian.png" alt="V" title="Vegetariánské" />}
            </span>
            <span className={styles.menuItemPrice}>{item.price}</span>
          </div>
        );
      })}
    </div>
  );
}

function RestaurantCard({ r, favorites, onToggleFav, onHide }) {
  const hasMenu = r.menu && (
    (r.menu.soups && r.menu.soups.length > 0) ||
    (r.menu.meals && r.menu.meals.length > 0) ||
    (r.menu.weekly && r.menu.weekly.length > 0)
  );

  return (
    <div className={styles.restaurant} style={{ borderLeftColor: RESTAURANT_COLORS[r.id] || '#a8a29e' }}>
      <div className={styles.restaurantHeader}>
        <span className={styles.restaurantName}>{r.name}</span>
        <button className={styles.hideBtn} onClick={() => onHide(r.id)} title="Skrýt restauraci">✕</button>
      </div>

      {!hasMenu ? (
        <div className={styles.closedMessage}>Restaurace zatím nezveřejnila menu. Jakmile jej zveřejní, zobrazí se zde.</div>
      ) : (
        <div className={styles.menuSection}>
          <MenuGroup label={r.menu.soups && r.menu.soups.length === 1 ? "Polévka" : "Polévky"} items={r.menu.soups} favorites={favorites} onToggleFav={onToggleFav} />
          <MenuGroup label="Denní menu" items={r.menu.meals} favorites={favorites} onToggleFav={onToggleFav} />
          <MenuGroup label="Týdenní nabídka" items={r.menu.weekly} favorites={favorites} onToggleFav={onToggleFav} />
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
  const [loadError, setLoadError] = useState(false);
  const [randomPick, setRandomPick] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [weather, setWeather] = useState(null);
  const [hidden, setHidden] = useState([]);
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dateStr = `${DAYS[dayOfWeek]} ${now.getDate()}. ${MONTHS[now.getMonth()]}`;

  useEffect(() => {
    setFavorites(getFavorites());
    setHidden(getHiddenRestaurants());
    fetch('/api/menus').then(r => r.json()).then(setData).catch(() => setLoadError(true));
    // Brno weather check
    fetch('https://api.open-meteo.com/v1/forecast?latitude=49.19&longitude=16.61&current=weather_code')
      .then(r => r.json())
      .then(w => {
        // Weather codes 51-67: drizzle/rain, 71-77: snow, 80-82: rain showers, 95-99: thunderstorm
        const code = w?.current?.weather_code;
        if (code >= 71 && code <= 77) setWeather('snow');
        else if (code > 65) setWeather('rain');
      })
      .catch(() => {});
  }, []);

  // Auto-refresh every 10 min if some restaurants are missing menus
  useEffect(() => {
    if (!data || !data.restaurants || isWeekend) return;
    const hasMenu = r => r.menu && (
      (r.menu.soups && r.menu.soups.length > 0) ||
      (r.menu.meals && r.menu.meals.length > 0) ||
      (r.menu.weekly && r.menu.weekly.length > 0)
    );
    const allHaveMenu = data.restaurants.every(hasMenu);
    if (allHaveMenu) return;

    const interval = setInterval(async () => {
      try {
        await fetch('/api/scrape');
        const res = await fetch('/api/menus');
        setData(await res.json());
      } catch (e) { console.error(e); }
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [data, isWeekend]);

  const toggleFav = useCallback((name) => {
    const clean = stripNumber(name);
    setFavorites(prev => {
      const n = normalize(name);
      const removing = prev.some(f => normalize(f.name) === n);
      let next;
      if (removing) {
        next = prev.filter(f => normalize(f.name) !== n);
      } else {
        next = [...prev, { name: clean, addedAt: getToday() }];
      }
      saveFavorites(next);

      // Track to server
      fetch('/api/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal: clean, action: removing ? 'remove' : 'add' }),
      }).catch(() => {});

      return next;
    });
  }, []);

  const toggleHide = useCallback((id) => {
    setHidden(prev => {
      const next = prev.includes(id) ? prev.filter(h => h !== id) : [...prev, id];
      saveHiddenRestaurants(next);
      return next;
    });
  }, []);

  // Visible and hidden restaurant lists
  const visibleRestaurants = data?.restaurants?.filter(r => !hidden.includes(r.id)) || [];
  const hiddenRestaurants = data?.restaurants?.filter(r => hidden.includes(r.id)) || [];

  // Find old favorites that are in today's menu
  const todayFavorites = [];
  if (visibleRestaurants.length > 0 && favorites.length > 0) {
    for (const r of visibleRestaurants) {
      if (!r.menu) continue;
      for (const section of ['meals', 'weekly']) {
        for (const item of (r.menu[section] || [])) {
          if (isOldFavorite(item.name, favorites)) {
            todayFavorites.push({ meal: item, restaurant: r.name });
          }
        }
      }
    }
  }

  function pickRandom() {
    if (visibleRestaurants.length === 0) return;
    const allMeals = [];
    for (const r of visibleRestaurants) {
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
    const filtered = allMeals.length > 1 && randomPick
      ? allMeals.filter(m => m.meal.name !== randomPick.meal.name)
      : allMeals;
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    const msg = RANDOM_MESSAGES[Math.floor(Math.random() * RANDOM_MESSAGES.length)];
    setRandomPick({ ...pick, message: msg });
    if (window.innerWidth <= 640) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
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
        <meta property="og:title" content="Obědy v okolí JIC" />
        <meta property="og:description" content="Denní menu restaurací v okolí JIC Brno — Kancl Bistro, Cookpoint, Bistro 22, QWERTY, Jean Paul's" />
        <meta property="og:image" content="https://jicobedy.cz/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:type" content="website" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1 className={styles.title}>Obědy v okolí <img className={styles.jicLogo} src="/jic.png" alt="JIC" /></h1>
          <span className={styles.date}>{dateStr}</span>
          {!isWeekend && visibleRestaurants.length > 0 && (
            <button className={styles.randomBtn} onClick={pickRandom}>
              🎲&nbsp;&nbsp;Náhodné jídlo
            </button>
          )}
        </div>
      </header>

      {weather && (
        <div className={styles.rainBanner}>
          {weather === 'snow'
            ? <><span className={styles.weatherEmoji}>❄️</span><span>Venku sněží — oblékni se teple!</span></>
            : <><img className={styles.rainIcon} src="/umbrella.svg" alt="" /><span>Venku prší — nezapomeň si deštník!</span></>
          }
        </div>
      )}

      <main className={styles.main}>
        {isWeekend ? (
          <div className={styles.weekendMessage}>
            Dnes je víkend — restaurace mají zavřeno.<br />
            Užij si volno a uvař si něco dobrého doma!
          </div>
        ) : (
          <>
            {randomPick && (
              <div className={styles.randomResult}>
                <div className={styles.randomMessage}>{randomPick.message}</div>
                <div className={styles.randomMeal}>{stripNumber(randomPick.meal.name)}</div>
                <div className={styles.randomRestaurant}>{randomPick.restaurant} {randomPick.meal.price && `· ${randomPick.meal.price}`}</div>
              </div>
            )}

            {todayFavorites.length > 0 && (
              <div className={styles.favoritesSection}>
                <div className={styles.favoritesTitle}>❤️&nbsp;&nbsp;&nbsp;Tvoje oblíbená jídla dnes v nabídce</div>
                {todayFavorites.map((f, i) => (
                  <div key={i} className={styles.favoriteItem}>
                    <span className={styles.favoriteMeal}>{stripNumber(f.meal.name)}</span>
                    <span className={styles.favoriteRestaurant}>{f.restaurant} {f.meal.price && `· ${f.meal.price}`}</span>
                  </div>
                ))}
              </div>
            )}

            {loadError ? (
              <div className={styles.loading}>Menu se nepodařilo načíst. Zkus obnovit stránku.</div>
            ) : !data || !data.restaurants || data.restaurants.length === 0 ? (
              <div className={styles.loading}>Načítám menu...</div>
            ) : (
              <>
                {[...visibleRestaurants].sort((a, b) => {
                  const aHas = a.menu && ((a.menu.soups && a.menu.soups.length > 0) || (a.menu.meals && a.menu.meals.length > 0) || (a.menu.weekly && a.menu.weekly.length > 0));
                  const bHas = b.menu && ((b.menu.soups && b.menu.soups.length > 0) || (b.menu.meals && b.menu.meals.length > 0) || (b.menu.weekly && b.menu.weekly.length > 0));
                  if (aHas === bHas) return 0;
                  return aHas ? -1 : 1;
                }).map(r => <RestaurantCard key={r.id} r={r} favorites={favorites} onToggleFav={toggleFav} onHide={toggleHide} />)}

                {hiddenRestaurants.length > 0 && (
                  <div className={styles.hiddenSection}>
                    <div className={styles.hiddenTitle}>Skryté restaurace</div>
                    {hiddenRestaurants.map(r => (
                      <div key={r.id} className={styles.hiddenItem}>
                        <span className={styles.hiddenName}>{r.name}</span>
                        <button className={styles.unhideBtn} onClick={() => toggleHide(r.id)}>Zobrazit</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <footer className={styles.footer}>
        <p>Data z <a href="https://www.menicka.cz" target="_blank" rel="noopener noreferrer">menicka.cz</a> a webů restaurací</p>
      </footer>
    </>
  );
}
