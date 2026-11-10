// Filament moved to https://filament-nyc.com. This page forwards anyone who opens the old
// address, signed in, with their preferences. Everything travels in the #fragment, which
// browsers never send to any server. Nothing personal is stored in this page.
(function () {
  var HOME = "https://filament-nyc.com/";
  var FRIENDS = "https://friends.filament-nyc.com";
  var hash = location.hash.slice(1);
  var out = new URLSearchParams();
  // Links that already carry something (join, invite, add-me, email #settings) pass straight through.
  if (/(^|&)(join|invite|connect|add)=/.test(hash)) { location.replace(HOME + "#" + hash); return; }
  var conn = null, prefs = {};
  try {
    conn = JSON.parse(localStorage.getItem("filament.connection.v1") || "null");
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (/^filament\./.test(k) && !/^filament\.(connection\.v1|cache\.v1|local\.settings)$/.test(k)) prefs[k] = localStorage.getItem(k);
    }
  } catch (e) { /* private window: just go */ }
  if (conn && conn.mode === "friend" && conn.key) { out.set("invite", conn.key); out.set("api", FRIENDS); }
  else if (conn && conn.owner && conn.token) {
    out.set("connect", btoa(JSON.stringify({ o: conn.owner, r: conn.repo || "filament", t: conn.token, b: conn.branch || "main" })));
  }
  if (conn) out.set("moved", "1");
  try { if (Object.keys(prefs).length) out.set("prefs", btoa(unescape(encodeURIComponent(JSON.stringify(prefs))))); } catch (e) { /* skip */ }
  if (hash === "settings") out.set("view", "settings");
  location.replace(HOME + (out.toString() ? "#" + out.toString() : ""));
})();
