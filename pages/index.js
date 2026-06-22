import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import confetti from "canvas-confetti";
import styles from "@/styles/Home.module.css";
import { hasMenuData } from "@/lib/menu";

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

// 14 oficiálních alergenů dle ČR/EU (nařízení 1169/2011)
const ALLERGENS = [
  { num: 1, label: 'Lepek (obiloviny)' },
  { num: 2, label: 'Korýši' },
  { num: 3, label: 'Vejce' },
  { num: 4, label: 'Ryby' },
  { num: 5, label: 'Arašídy' },
  { num: 6, label: 'Sója' },
  { num: 7, label: 'Mléko a laktóza' },
  { num: 8, label: 'Skořápkové plody (ořechy)' },
  { num: 9, label: 'Celer' },
  { num: 10, label: 'Hořčice' },
  { num: 11, label: 'Sezam' },
  { num: 12, label: 'Oxid siřičitý a siřičitany' },
  { num: 13, label: 'Vlčí bob (lupina)' },
  { num: 14, label: 'Měkkýši' },
];

function getExcludedAllergens() {
  try {
    return JSON.parse(localStorage.getItem('excludedAllergens') || '[]');
  } catch { return []; }
}

function saveExcludedAllergens(nums) {
  localStorage.setItem('excludedAllergens', JSON.stringify(nums));
}

// "1a, 3, 7" → [1, 3, 7]
function parseAllergenNums(str) {
  if (!str) return [];
  return str.split(',').map(t => parseInt(t, 10)).filter(n => !isNaN(n));
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

function RestaurantCard({ r, hadMenu, favorites, onToggleFav, onHide }) {
  const hasMenu = hasMenuData(r);
  // hadMenu = menu mělo položky, ale filtr alergenů je všechny skryl
  const allFilteredOut = !hasMenu && hadMenu;
  // restaurace, která u žádné položky neuvádí alergeny (např. Kancl Bistro na menicka)
  const items = hasMenu ? [...(r.menu.soups || []), ...(r.menu.meals || []), ...(r.menu.weekly || [])] : [];
  const noAllergenInfo = items.length > 0 && items.every(i => !i.allergens);

  return (
    <div className={styles.restaurant} style={{ borderLeftColor: RESTAURANT_COLORS[r.id] || '#a8a29e' }}>
      <div className={styles.restaurantHeader}>
        <span className={styles.restaurantName}>{r.name}</span>
        <button className={styles.hideBtn} onClick={() => onHide(r.id)} title="Skrýt restauraci">✕</button>
      </div>

      {!hasMenu ? (
        <div className={styles.closedMessage}>
          {allFilteredOut
            ? 'Všechna dnešní jídla obsahují alergeny, které jsi vyřadil.'
            : 'Restaurace zatím nezveřejnila menu. Jakmile jej zveřejní, zobrazí se zde.'}
        </div>
      ) : (
        <div className={styles.menuSection}>
          <MenuGroup label={r.menu.soups && r.menu.soups.length === 1 ? "Polévka" : "Polévky"} items={r.menu.soups} favorites={favorites} onToggleFav={onToggleFav} />
          <MenuGroup label="Denní menu" items={r.menu.meals} favorites={favorites} onToggleFav={onToggleFav} />
          <MenuGroup label="Týdenní nabídka" items={r.menu.weekly} favorites={favorites} onToggleFav={onToggleFav} />
          {noAllergenInfo && <div className={styles.noAllergenNote}>Restaurace neuvádí alergeny.</div>}
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
  const [excluded, setExcluded] = useState([]);
  const [showAllergenPanel, setShowAllergenPanel] = useState(false);
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dateStr = `${DAYS[dayOfWeek]} ${now.getDate()}. ${MONTHS[now.getMonth()]}`;

  useEffect(() => {
    setFavorites(getFavorites());
    setHidden(getHiddenRestaurants());
    setExcluded(getExcludedAllergens());
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

  // Auto-refresh every 10 min if some restaurants are missing menus.
  // /api/refresh má serverový zámek — scrape proběhne max. 1× za 10 min
  // bez ohledu na počet otevřených prohlížečů.
  useEffect(() => {
    if (!data || !data.restaurants || isWeekend) return;
    const allHaveMenu = data.restaurants.every(hasMenuData);
    if (allHaveMenu) return;

    const interval = setInterval(async () => {
      try {
        await fetch('/api/refresh');
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

  const toggleAllergen = useCallback((num) => {
    setExcluded(prev => {
      const next = prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num];
      saveExcludedAllergens(next);
      return next;
    });
  }, []);

  const clearAllergens = useCallback(() => {
    setExcluded([]);
    saveExcludedAllergens([]);
  }, []);

  // Filtr alergenů: jídlo skryjeme, jen pokud MÁ známé alergeny a některý z nich je vyřazený.
  // Jídla bez údaje o alergenech necháváme viditelná (neumíme potvrdit, že je neobsahují).
  const excludedSet = new Set(excluded);
  const itemVisible = useCallback((item) => {
    if (excludedSet.size === 0) return true;
    const nums = parseAllergenNums(item.allergens);
    if (nums.length === 0) return true;
    return !nums.some(n => excludedSet.has(n));
  }, [excluded]);

  function filterMenu(menu) {
    if (!menu) return menu;
    return {
      ...menu,
      soups: (menu.soups || []).filter(itemVisible),
      meals: (menu.meals || []).filter(itemVisible),
      weekly: (menu.weekly || []).filter(itemVisible),
    };
  }

  // Visible and hidden restaurant lists (menu už profiltrované přes alergeny)
  const visibleRestaurants = (data?.restaurants?.filter(r => !hidden.includes(r.id)) || [])
    .map(r => ({ ...r, menu: filterMenu(r.menu), hadMenu: hasMenuData(r) }));
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
          {!isWeekend && (
            <button
              className={`${styles.allergenBtn} ${excluded.length > 0 ? styles.allergenBtnActive : ''}`}
              onClick={() => setShowAllergenPanel(v => !v)}
            >
              🚫&nbsp;&nbsp;Filtr alergenů{excluded.length > 0 ? ` (${excluded.length})` : ''}
            </button>
          )}
          {!isWeekend && visibleRestaurants.length > 0 && (
            <button className={styles.randomBtn} onClick={pickRandom}>
              🎲&nbsp;&nbsp;Náhodné jídlo
            </button>
          )}
        </div>
      </header>

      {!isWeekend && showAllergenPanel && (
        <div className={styles.allergenPanel}>
          <div className={styles.allergenPanelInner}>
            <div className={styles.allergenPanelHead}>
              <span className={styles.allergenPanelTitle}>Skrýt jídla obsahující alergen:</span>
              {excluded.length > 0 && (
                <button className={styles.allergenClear} onClick={clearAllergens}>Zrušit výběr</button>
              )}
            </div>
            <div className={styles.allergenGrid}>
              {ALLERGENS.map(a => (
                <label key={a.num} className={styles.allergenOption}>
                  <input
                    type="checkbox"
                    checked={excluded.includes(a.num)}
                    onChange={() => toggleAllergen(a.num)}
                  />
                  <span className={styles.allergenNum}>{a.num}</span>
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
            <div className={styles.allergenNote}>
              Alergeny přebíráme z menu restaurací (u některých čteme z fotky pomocí AI), mohou se vyskytnout chyby. Při alergii se vždy řiď údaji přímo v restauraci. Jídla bez uvedených alergenů se nefiltrují.
            </div>
          </div>
        </div>
      )}

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
                  const aHas = hasMenuData(a);
                  const bHas = hasMenuData(b);
                  if (aHas === bHas) return 0;
                  return aHas ? -1 : 1;
                }).map(r => <RestaurantCard key={r.id} r={r} hadMenu={r.hadMenu} favorites={favorites} onToggleFav={toggleFav} onHide={toggleHide} />)}

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
