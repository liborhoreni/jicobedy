import { getRedis } from '../../lib/kv';

const DEMO_DATA = {
  date: '14. 4. 2026',
  scrapedAt: new Date().toISOString(),
  restaurants: [
    {
      id: '8518', name: 'Kancl Bistro', slug: 'kancl-bistro',
      logo: '/logos/kancl.jpg',
      sourceUrl: 'https://www.menicka.cz/8518-kancl-bistro.html',
      menu: {
        soups: [
          { name: 'Gulášová polévka', price: '49 Kč' },
          { name: 'Mrkvový krém se zázvorem a kokosovým mlékem', price: '49 Kč', veggie: true },
        ],
        meals: [
          { name: '1. Butter chicken, jasmínová rýže, koriandr', price: '189 Kč', spicy: true },
          { name: '2. Čerstvé spaghetti bolognese, parmezán', price: '189 Kč' },
          { name: '3. Grilovaná panenka sous-vide, celerové pyré, dijonský krém', price: '199 Kč' },
          { name: '4. Asijský salát z rýžových nudlí, manga a tofu', price: '189 Kč', veggie: true },
          { name: '5. Hummus, křupavá brokolice, pesto, balkánský sýr, pita', price: '189 Kč', veggie: true },
        ],
      },
      closed: false,
    },
    {
      id: '4931', name: 'Jídelna CEITEC', slug: 'cook-point',
      logo: '/logos/cookpoint.jpg',
      sourceUrl: 'https://www.menicka.cz/4931-cook-point.html',
      menu: {
        soups: [
          { name: 'Hovězí vývar s nudlemi', price: '35 Kč' },
        ],
        meals: [
          { name: '1. Kuřecí řízek, bramborový salát', price: '155 Kč' },
          { name: '2. Vepřový guláš, houskový knedlík', price: '145 Kč' },
          { name: '3. Zapečené těstoviny se špenátem a ricottou', price: '139 Kč', veggie: true },
        ],
      },
      closed: false,
    },
    {
      id: 'bistro22', name: 'Bistro 22', slug: 'bistro-22',
      logo: '/logos/bistro22.jpg',
      sourceUrl: 'https://bistro22.cz/',
      menu: {
        soups: [
          { name: 'Zeleninový krém', price: '', veggie: true },
        ],
        meals: [
          { name: 'Kuřecí Tandoori, jasmínová rýže, raita', price: '165 Kč', spicy: true },
          { name: 'Pečená krkovička, bramborové pyré, šťáva', price: '165 Kč' },
        ],
      },
      closed: false,
    },
    {
      id: 'qwerty', name: 'QWERTY', slug: 'qwerty',
      logo: '/logos/qwerty.png',
      sourceUrl: 'https://qwerty-restaurant--catering3.webnode.cz/menu/',
      menu: {
        soups: [
          { name: 'Zeleninový krém s krutony', price: '20 Kč', veggie: true },
          { name: 'Batátový krém s paprikou a mungo klíčky', price: '20 Kč', veggie: true },
        ],
        meals: [
          { name: 'Vepřové nudličky na cibulce s jasmínovou rýží a jarní cibulkou', price: '180 Kč' },
        ],
        weekly: [
          { name: 'Dukátové buchtičky s vanilkovým krémem a borůvkami', price: '175 Kč', veggie: true },
          { name: 'Zeleninový salát s grilovaným hermelínem a bylinkovou bagetou', price: '189 Kč', veggie: true },
          { name: 'Grilovaná krkovice s pepřovou omáčkou a bramborové krokety', price: '205 Kč' },
          { name: 'Konfitované kachní stehno, variace zelí a bramborové noky', price: '225 Kč' },
          { name: 'PIZZA: Diavola / Ventricina / Americana / Quattro Formaggi', price: '189 Kč' },
        ],
      },
      closed: false,
    },
    {
      id: '3884', name: "Jean Paul's", slug: 'jean-pauls',
      logo: '/logos/jeanpauls.jpg',
      sourceUrl: 'https://www.menicka.cz/3884-jean-pauls-.html',
      menu: {
        soups: [
          { name: 'Celerový krém s pažitkou a olivovým olejem', price: '35 Kč', veggie: true },
        ],
        meals: [
          { name: '1. Nudličky z vepřové panenky s omáčkou boscaiola, jasmínová rýže', price: '185 Kč' },
          { name: '2. Smažený krůtí řízek, salát coleslaw, pečené brambory', price: '185 Kč' },
        ],
      },
      closed: false,
    },
  ],
};

export default async function handler(req, res) {
  const kv = getRedis();
  if (!kv) {
    return res.json(DEMO_DATA);
  }
  try {
    const data = await kv.get('menus');
    res.json(data || { date: null, restaurants: [], scrapedAt: null });
  } catch (err) {
    res.json(DEMO_DATA);
  }
}
