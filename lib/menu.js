function hasMenuData(r) {
  return !!(r.menu && (
    (r.menu.soups && r.menu.soups.length > 0) ||
    (r.menu.meals && r.menu.meals.length > 0) ||
    (r.menu.weekly && r.menu.weekly.length > 0)
  ));
}

module.exports = { hasMenuData };
