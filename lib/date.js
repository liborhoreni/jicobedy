// Vercel běží v UTC — všechna "dnešní" data musí vycházet z pražského času
function pragueNow(dateOverride) {
  if (dateOverride) return new Date(dateOverride);
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
}

function pragueDateString() {
  return new Date().toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
}

module.exports = { pragueNow, pragueDateString };
