// Sdílený wrapper nad Apify Facebook Posts Scraperem (async run + poll).
// Používají kancl-fb.js i qwerty-fb.js — dřív měl každý vlastní kopii.
export async function runApify(token, { actor, startUrl, resultsLimit = 5 }) {
  // Token posíláme v hlavičce, ne v adrese — adresy se běžně objevují v logách.
  const auth = { Authorization: `Bearer ${token}` };
  const input = { captionText: false, resultsLimit, startUrls: [{ url: startUrl }] };
  const res = await fetch(`https://api.apify.com/v2/acts/${actor}/runs`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!body.data) throw new Error('Apify run nešlo spustit: ' + JSON.stringify(body).slice(0, 200));
  const { id: runId, defaultDatasetId: dsId } = body.data;

  let status = body.data.status;
  for (let i = 0; i < 18 && status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED'; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: auth });
    status = (await r.json()).data.status;
  }
  if (status !== 'SUCCEEDED') throw new Error('Apify run skončil stavem ' + status);

  const items = await (await fetch(`https://api.apify.com/v2/datasets/${dsId}/items?clean=true`, { headers: auth })).json();
  return Array.isArray(items) ? items : [];
}
