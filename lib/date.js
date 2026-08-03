// Vercel běží v UTC — všechna "dnešní" data musí vycházet z pražského času
function pragueNow(dateOverride) {
  if (dateOverride) return new Date(dateOverride);
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
}

function pragueDateString() {
  return new Date().toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
}

// "2026-08-03" v pražském čase. Pozor: new Date().toISOString() vrací UTC, takže
// mezi půlnocí a druhou ranní ukazuje ještě včerejšek.
function pragueDayId(dateOverride) {
  const d = pragueNow(dateOverride);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Porovnatelný klíč dne: 3. 8. 2026 → 20260803.
// Dřív se používalo měsíc*100+den, jenže to se rozbije přes přelom roku:
// týden "29/12 - 2/1" dal rozsah od 1229 do 102, který nepokryl ani jeden den.
function dayKey(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function todayKey(dateOverride) {
  return dayKey(pragueNow(dateOverride));
}

// Rozsah zapsaný bez roku ("3/8 - 7/8" na fotce menu) → klíče od/do.
// Rok doplníme podle dneška a ošetříme týden přes Silvestra.
function rangeKeys({ fromDay, fromMonth, toDay, toMonth }, dateOverride) {
  const today = pragueNow(dateOverride);
  let fromYear = today.getFullYear();
  // Je leden a rozsah začíná v prosinci → týden začal ještě loni.
  if (fromMonth === 12 && today.getMonth() + 1 === 1) fromYear -= 1;
  // Rozsah končí dřívějším měsícem, než začal → přetéká do dalšího roku.
  const toYear = toMonth < fromMonth ? fromYear + 1 : fromYear;
  return {
    fromKey: fromYear * 10000 + fromMonth * 100 + fromDay,
    toKey: toYear * 10000 + toMonth * 100 + toDay,
  };
}

// Označení týdne datem jeho pondělí ("2026-08-03"). Týdenní menu platí po–pá,
// takže podle toho poznáme, jestli je uložený záznam ještě z tohoto týdne.
function weekKey(dateOverride) {
  const d = pragueNow(dateOverride);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

// Pokrývá uložený týdenní záznam { fromKey, toKey } zadaný den?
function covers(entry, key) {
  return !!(entry && entry.fromKey <= key && key <= entry.toKey);
}

module.exports = { pragueNow, pragueDateString, pragueDayId, dayKey, todayKey, rangeKeys, weekKey, covers };
