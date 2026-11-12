/* KOMP – familiens lukkede bildedeling */
const CFG = window.KOMP_CONFIG;
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
const $ = id => document.getElementById(id);
const DAY = 864e5, H = 36e5;
const MAX_VIDEO = 50 * 1024 * 1024;

const AV_COLORS = [["#C08A2E","#7E7A2C"],["#B86FB0","#C4466A"],["#D58A2E","#A35A1E"],["#4A8FD0","#3557A8"],["#6FA58C","#3C7060"],
                   ["#D0655A","#9A3B44"],["#8C7AD6","#5B4AA8"],["#3FA8A8","#2A6F80"],["#C9A23A","#8F6F22"],["#E07A9A","#A8506E"]];
const ICON = {
  glass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 2h12M6 22h12M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
};

const params = new URLSearchParams(location.search);
const inviteFromUrl = params.get("invite");
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

let me = null;          // { id, email, profile }
let profiles = {};      // id -> profile
let posts = [];
let urls = {};          // storage path -> signed url
let channel = null;

/* ---------- små hjelpere ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2200); }
function hideSplash() {
  const sp = $("splash");
  if (!sp || sp.classList.contains("gone")) return;
  sp.classList.add("gone");
  setTimeout(() => sp.remove(), 300);
}
setTimeout(hideSplash, 6000); // sikkerhetsnett hvis nettet er tregt
function show(id) {
  if (id !== "app") hideSplash();
  ["auth", "install", "app"].forEach(s => $(s).hidden = s !== id);
  ["compose", "me"].forEach(s => $(s).hidden = true);
  document.body.style.overflow = id === "app" ? "" : "hidden";
}
function avStyle(p) {
  if (p?.avatar_path && urls[p.avatar_path]) return `background-image:url("${urls[p.avatar_path]}")`;
  const g = AV_COLORS[(p?.color ?? 0) % AV_COLORS.length];
  return `background-image:linear-gradient(135deg,${g[0]},${g[1]})`;
}
function avHtml(p, cls = "") {
  const hasImg = p?.avatar_path && urls[p.avatar_path];
  return `<div class="av ${cls}" style='${avStyle(p)}'>${hasImg ? "" : esc((p?.display_name || "?")[0].toUpperCase())}</div>`;
}
function paintAv(el, p) {
  el.setAttribute("style", avStyle(p));
  el.textContent = p?.avatar_path && urls[p.avatar_path] ? "" : (p?.display_name || "?")[0].toUpperCase();
}
const WD = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
function when(iso) {
  const d = new Date(iso), hm = d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / DAY);
  if (diff <= 0) return "i dag kl. " + hm;
  if (diff === 1) return "i går kl. " + hm;
  if (diff < 7) return WD[d.getDay()] + " kl. " + hm;
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "long" }) + " kl. " + hm;
}
function left(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms >= DAY) { const n = Math.floor(ms / DAY); return n + (n === 1 ? " dag" : " dager") + " igjen"; }
  const h = Math.max(1, Math.ceil(ms / H)); return h + (h === 1 ? " time" : " timer") + " igjen";
}
function norskFeil(e) {
  const m = (e?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "Feil e-post eller passord.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Det finnes allerede en bruker med denne e-posten. Logg inn i stedet.";
  if (m.includes("password") && m.includes("6")) return "Passordet er for kort.";
  if (m.includes("email") && m.includes("invalid")) return "E-postadressen ser ikke riktig ut.";
  if (m.includes("database error") || m.includes("invitasjon")) return "Invitasjonen er ugyldig eller utløpt. Be om en ny lenke.";
  if (m.includes("rate limit")) return "For mange forsøk. Vent litt og prøv igjen.";
  return "Noe gikk galt. Sjekk nettet og prøv igjen.";
}
document.querySelectorAll(".eye").forEach(b => {
  b.innerHTML = ICON.eye;
  b.onclick = () => { const i = $(b.dataset.for); const s = i.type === "password"; i.type = s ? "text" : "password"; b.setAttribute("aria-label", s ? "Skjul passord" : "Vis passord"); };
});

/* ---------- innlogging og registrering ---------- */
function showAuth(view) {
  show("auth");
  $("signup-form").hidden = view !== "signup";
  $("login-form").hidden = view !== "login";
  $("msg-box").hidden = view !== "msg";
  if (view === "signup") {
    $("su-code").value = inviteFromUrl || "";
    $("su-code-wrap").hidden = !!inviteFromUrl;
    $("signup-lead").textContent = inviteFromUrl
      ? "Du er invitert til familiens bildedeling. Lag en bruker for å bli med."
      : "Lag en bruker. Du trenger invitasjonskoden fra lenken du fikk.";
  }
}
document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => showAuth(b.dataset.go));
function authMsg(t) { $("msg-text").textContent = t; showAuth("msg"); }

$("signup-form").onsubmit = async e => {
  e.preventDefault();
  const name = $("su-name").value.trim(), email = $("su-email").value.trim(), pw = $("su-pw").value, code = $("su-code").value.trim();
  const err = $("su-err"); err.hidden = true;
  const fail = t => { err.textContent = t; err.hidden = false; };
  if (!name) return fail("Skriv inn navnet ditt.");
  if (!email.includes("@")) return fail("Skriv inn e-postadressen din.");
  if (pw.length < 8) return fail("Passordet må ha minst 8 tegn.");
  const isAdmin = email.toLowerCase() === CFG.adminEmail.toLowerCase();
  $("su-btn").disabled = true;
  try {
    if (!isAdmin) {
      const { data: ok, error } = await sb.rpc("check_invite", { c: code });
      if (error) throw error;
      if (!ok) return fail("Invitasjonen er ugyldig eller utløpt. Be om en ny lenke.");
    }
    const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { display_name: name, invite_code: code }, emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    if (!data.session) return authMsg("Nesten ferdig! Vi har sendt deg en e-post. Trykk på lenken i den for å bekrefte, og logg så inn.");
    history.replaceState(null, "", location.pathname);
    await enter(data.session);
  } catch (ex) { fail(norskFeil(ex)); }
  finally { $("su-btn").disabled = false; }
};

$("login-form").onsubmit = async e => {
  e.preventDefault();
  const err = $("li-err"); err.hidden = true;
  $("li-btn").disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email: $("li-email").value.trim(), password: $("li-pw").value });
  $("li-btn").disabled = false;
  if (error) { err.textContent = norskFeil(error); err.hidden = false; return; }
  await enter(data.session);
};

$("forgot").onclick = async () => {
  const email = $("li-email").value.trim();
  const err = $("li-err");
  if (!email.includes("@")) { err.textContent = "Skriv inn e-postadressen din først, så sender vi en lenke."; err.hidden = false; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) { err.textContent = norskFeil(error); err.hidden = false; return; }
  authMsg("Vi har sendt deg en e-post med en lenke for å lage nytt passord.");
};

/* ---------- inn i appen ---------- */
async function enter(session) {
  const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (!prof || prof.blocked) {
    await sb.auth.signOut();
    authMsg("Du har ikke tilgang til KOMP. Spør den som inviterte deg om en ny lenke.");
    return;
  }
  me = { id: session.user.id, email: session.user.email, profile: prof };
  if (isMobile && !isStandalone && !store.get("komp-install-seen")) {
    store.set("komp-install-seen", "1");
    show("install");
    $("install-done").onclick = () => startApp();
    return;
  }
  startApp();
}

async function startApp() {
  show("app");
  $("install-banner").hidden = !(isMobile && !isStandalone);
  $("push-banner").hidden = !(pushState() === "ok" && Notification.permission === "default" && !store.get("komp-push-dismissed"));
  paintAv($("me-btn"), me.profile);
  syncPush();
  await loadAll();
  hideSplash();
  if (!channel) {
    channel = sb.channel("posts")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => loadAll())
      .subscribe();
  }
  if (me.profile.is_admin) purgeExpired();
}

async function loadAll() {
  const [{ data: profs }, { data: ps, error }] = await Promise.all([
    sb.from("profiles").select("*"),
    sb.from("posts").select("*").order("created_at", { ascending: false }).limit(300)
  ]);
  if (error) { $("posts").innerHTML = '<p class="empty">Fikk ikke hentet bildene. Sjekk nettet og prøv igjen.</p>'; return; }
  profiles = Object.fromEntries((profs || []).map(p => [p.id, p]));
  if (profiles[me.id]) me.profile = profiles[me.id];
  posts = ps || [];
  const paths = [...posts.map(p => p.media_path), ...Object.values(profiles).map(p => p.avatar_path).filter(Boolean)]
    .filter(p => !urls[p]);
  if (paths.length) {
    const { data } = await sb.storage.from("media").createSignedUrls(paths, 60 * 60 * 6);
    (data || []).forEach(d => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
  }
  render();
}

function render() {
  paintAv($("me-btn"), me.profile);
  const live = posts.filter(p => !p.expires_at || new Date(p.expires_at) > Date.now());
  if (!live.length) { $("posts").innerHTML = '<p class="empty">Ingen bilder akkurat nå. Trykk på + for å dele noe.</p>'; return; }
  $("posts").innerHTML = live.map(p => {
    const a = profiles[p.author] || { display_name: "Ukjent", color: 0 };
    const url = urls[p.media_path] || "";
    const ar = p.width && p.height ? `aspect-ratio:${p.width}/${p.height}` : "";
    const media = p.media_type === "video"
      ? `<video class="media" src="${url}" style="${ar}" controls playsinline preload="metadata"></video>`
      : `<img class="media" src="${url}" style="${ar}" alt="Bilde fra ${esc(a.display_name)}" loading="lazy">`;
    const canDelete = p.author === me.id || me.profile.is_admin;
    return `<article class="post">
      <div class="post-head">
        ${avHtml(a)}
        <div class="who"><b>${esc(a.display_name)}</b><span class="meta">${when(p.created_at)}${p.expires_at ? ` · ${ICON.glass} ${left(p.expires_at)}` : ""}</span></div>
        ${canDelete ? `<button class="del" type="button" data-del="${p.id}" aria-label="Slett innlegget">${ICON.trash}</button>` : ""}
      </div>
      ${media}
      ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ""}
    </article>`;
  }).join("");
}

$("posts").addEventListener("click", async e => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  if (!confirm("Vil du slette dette innlegget for alle?")) return;
  const p = posts.find(x => x.id === b.dataset.del);
  const { error } = await sb.from("posts").delete().eq("id", p.id);
  if (error) return toast("Kunne ikke slette. Prøv igjen.");
  await sb.storage.from("media").remove([p.media_path]);
  posts = posts.filter(x => x.id !== p.id); render(); toast("Innlegget er slettet");
});

async function purgeExpired() {
  const { data: paths } = await sb.rpc("purge_expired");
  if (paths && paths.length) await sb.storage.from("media").remove(paths);
}

$("install-banner").onclick = () => { show("install"); $("install-done").onclick = () => startApp(); };
setInterval(() => { if (!$("app").hidden) render(); }, 60000);

/* ---------- push-varsler ---------- */
function pushState() {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIOS && !isStandalone ? "install" : "unsupported";
  if (isIOS && !isStandalone) return "install";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}
function b64u(s) {
  const b = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
async function currentSub() {
  if (pushState() !== "ok") return null;
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); }
  catch { return null; }
}
async function saveSub(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc("save_push", { e: j.endpoint, k: j.keys.p256dh, a: j.keys.auth });
  if (error) throw error;
}
// Kobler denne enheten til brukeren som er logget inn (f.eks. etter innlogging på nytt).
async function syncPush() {
  if (pushState() !== "ok" || Notification.permission !== "granted") return;
  const sub = await currentSub();
  if (sub) saveSub(sub).catch(() => {});
}
async function enablePush() {
  const st = pushState();
  if (st === "install") { toast("Legg KOMP på hjemskjermen først, og åpne den derfra."); return false; }
  if (st === "unsupported") { toast("Denne enheten støtter ikke varsler."); return false; }
  if (st === "denied") { toast("Varsler er blokkert. Slå dem på i innstillingene for KOMP."); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Varsler ble ikke slått på."); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(CFG.vapidPublicKey) });
    await saveSub(sub);
    toast("Varsler er på");
    return true;
  } catch {
    toast("Fikk ikke slått på varsler. Prøv igjen.");
    return false;
  }
}
async function disablePush() {
  const sub = await currentSub();
  if (sub) { await sb.rpc("remove_push", { e: sub.endpoint }); await sub.unsubscribe().catch(() => {}); }
  toast("Varsler er av");
}
async function paintPush() {
  const sw = $("push-switch"), st = pushState();
  const sub = st === "ok" && Notification.permission === "granted" ? await currentSub() : null;
  sw.setAttribute("aria-checked", String(!!sub));
  sw.disabled = st !== "ok";
  $("push-help").textContent = {
    install: "Legg KOMP på hjemskjermen og åpne den derfra, så kan du slå på varsler.",
    unsupported: "Denne enheten eller nettleseren støtter ikke varsler.",
    denied: "Varsler er blokkert. Slå dem på i telefonens innstillinger for KOMP.",
    ok: "Få beskjed på denne enheten når noen deler noe."
  }[st];
}
$("push-switch").onclick = async () => {
  const sw = $("push-switch"); const on = sw.getAttribute("aria-checked") === "true";
  sw.disabled = true;
  if (on) await disablePush(); else await enablePush();
  await paintPush();
  $("push-banner").hidden = true;
};
$("push-banner").onclick = async () => {
  store.set("komp-push-dismissed", "1");
  await enablePush();
  $("push-banner").hidden = true;
};
// Hent nye innlegg når appen åpnes igjen (f.eks. fra et varsel).
document.addEventListener("visibilitychange", () => { if (!document.hidden && me && !$("app").hidden) loadAll(); });

/* ---------- nytt innlegg ---------- */
let src = null, kind = null, file = null, iw = 0, ih = 0, ratio = 0, zoom = 1, ox = 0, oy = 0, fw = 0, fh = 0, days = 2, objUrl = null;
const frame = $("frame"), cimg = $("c-img"), cvid = $("c-video");

function pick() { $("file").value = ""; $("file").click(); }
$("fab").onclick = pick;
document.querySelectorAll("[data-swap]").forEach(b => b.onclick = pick);

$("file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const first = $("compose").hidden;
  if (objUrl) URL.revokeObjectURL(objUrl);
  objUrl = URL.createObjectURL(f); file = f;
  if (f.type.startsWith("video/")) {
    if (f.size > MAX_VIDEO) { toast("Videoen er for stor (over 50 MB). Velg en kortere video."); return; }
    kind = "video"; src = null;
    cvid.src = objUrl;
    await new Promise(r => { cvid.onloadedmetadata = r; cvid.onerror = r; });
    iw = cvid.videoWidth; ih = cvid.videoHeight;
    $("vid-size").textContent = `Video · ${(f.size / 1048576).toFixed(1)} MB`;
  } else {
    kind = "image";
    const im = new Image(); im.src = objUrl;
    try { await im.decode(); } catch { toast("Fikk ikke åpnet bildet. Prøv et annet."); return; }
    src = im; iw = im.naturalWidth; ih = im.naturalHeight; cimg.src = objUrl;
  }
  frame.hidden = kind !== "image"; cvid.hidden = kind !== "video";
  $("img-tools").hidden = kind !== "image"; $("vid-tools").hidden = kind !== "video";
  if (first) { $("c-text").value = ""; setDays(2); setRatio(0); }
  zoom = 1; ox = oy = 0; $("zoom").value = 1;
  $("compose").hidden = false; document.body.style.overflow = "hidden";
  $("share").disabled = false; $("share").textContent = "Del med KOMP";
  if (kind === "image") layout();
};
function layout() {
  const box = $("cropbox"); const bw = box.clientWidth, bh = box.clientHeight; const r = ratio || iw / ih;
  fw = Math.min(bw, bh * r); fh = fw / r; frame.style.width = fw + "px"; frame.style.height = fh + "px"; place();
}
const base = () => Math.max(fw / iw, fh / ih);
function place() {
  const s = base() * zoom; const mx = Math.max(0, (iw * s - fw) / 2), my = Math.max(0, (ih * s - fh) / 2);
  ox = Math.max(-mx, Math.min(mx, ox)); oy = Math.max(-my, Math.min(my, oy));
  cimg.style.width = iw + "px"; cimg.style.height = ih + "px";
  cimg.style.transform = `translate(-50%,-50%) translate(${ox}px,${oy}px) scale(${s})`;
}
function setRatio(r) { ratio = r; document.querySelectorAll("#ratios [data-r]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.r === r)); if (src) layout(); }
$("ratios").addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) setRatio(+b.dataset.r); });
$("zoom").oninput = e => { zoom = +e.target.value; place(); };
const pts = new Map(); let pinch0 = null;
frame.addEventListener("pointerdown", e => { frame.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; } });
frame.addEventListener("pointermove", e => {
  if (!pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; zoom = Math.max(1, Math.min(3, pinch0.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d)); $("zoom").value = zoom; }
  else if (pts.size === 1) { ox += e.clientX - prev.x; oy += e.clientY - prev.y; }
  place();
});
["pointerup", "pointercancel"].forEach(t => frame.addEventListener(t, e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; }));
addEventListener("resize", () => { if (!$("compose").hidden && kind === "image") layout(); });

function setDays(d) {
  days = d; document.querySelectorAll("#seg button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.d === d));
  $("expiry-text").textContent = d ? `Slettes for godt om ${d} dager.` : "Ligger ute til du sletter det.";
}
$("seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setDays(+b.dataset.d); });
function closeCompose() { $("compose").hidden = true; document.body.style.overflow = ""; cvid.pause(); }
$("c-close").onclick = closeCompose;

function croppedBlob() {
  const s = base() * zoom;
  const sw = fw / s, sh = fh / s, sx = iw / 2 - ox / s - sw / 2, sy = ih / 2 - oy / s - sh / 2;
  const k = Math.min(2000 / Math.max(sw, sh), 1);
  const c = document.createElement("canvas"); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  c.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r({ blob: b, w: c.width, h: c.height }), "image/jpeg", 0.86));
}

$("share").onclick = async () => {
  if (!file) return;
  const btn = $("share"); btn.disabled = true; btn.textContent = kind === "video" ? "Laster opp video …" : "Deler …";
  try {
    let body, type, ext, w = iw, h = ih;
    if (kind === "image") { const r = await croppedBlob(); body = r.blob; w = r.w; h = r.h; type = "image/jpeg"; ext = "jpg"; }
    else { body = file; type = file.type || "video/mp4"; ext = (file.name.split(".").pop() || "mp4").toLowerCase(); }
    const path = `${me.id}/posts/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from("media").upload(path, body, { contentType: type });
    if (up.error) throw up.error;
    const { error } = await sb.from("posts").insert({
      author: me.id, caption: $("c-text").value.trim() || null, media_path: path, media_type: kind, width: w, height: h,
      expires_at: days ? new Date(Date.now() + days * DAY).toISOString() : null
    });
    if (error) { await sb.storage.from("media").remove([path]); throw error; }
    closeCompose(); await loadAll(); scrollTo({ top: 0, behavior: "smooth" }); toast("Delt med KOMP");
  } catch (ex) {
    toast("Kunne ikke dele. Sjekk nettet og prøv igjen.");
    btn.disabled = false; btn.textContent = "Del med KOMP";
  }
};

/* ---------- Meg ---------- */
function openMe() {
  paintAv($("me-av"), me.profile);
  $("me-name").textContent = me.profile.display_name;
  $("me-email").textContent = me.email;
  $("name-in").value = me.profile.display_name; $("name-save").disabled = true;
  $("pw-in").value = ""; $("pw-save").disabled = true;
  $("show-install").hidden = isStandalone;
  $("admin-box").hidden = !me.profile.is_admin;
  paintPush();
  if (me.profile.is_admin) loadAdmin();
  $("me").hidden = false; document.body.style.overflow = "hidden";
}
$("me-btn").onclick = openMe;
$("me-back").onclick = () => { $("me").hidden = true; document.body.style.overflow = ""; render(); };

$("name-in").oninput = e => { const v = e.target.value.trim(); $("name-save").disabled = !v || v === me.profile.display_name; };
$("name-save").onclick = async () => {
  const v = $("name-in").value.trim();
  const { error } = await sb.from("profiles").update({ display_name: v }).eq("id", me.id);
  if (error) return toast("Kunne ikke lagre navnet.");
  me.profile.display_name = v; profiles[me.id] = me.profile;
  $("me-name").textContent = v; paintAv($("me-av"), me.profile); $("name-save").disabled = true; toast("Navnet er lagret");
};
$("pw-in").oninput = e => { $("pw-save").disabled = e.target.value.length < 8; };
$("pw-save").onclick = async () => {
  const { error } = await sb.auth.updateUser({ password: $("pw-in").value });
  if (error) return toast(norskFeil(error));
  $("pw-in").value = ""; $("pw-save").disabled = true; toast("Passordet er lagret");
};
$("cam").onclick = () => { $("av-file").value = ""; $("av-file").click(); };
$("av-file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const u = URL.createObjectURL(f); const im = new Image(); im.src = u;
  try { await im.decode(); } catch { return toast("Fikk ikke åpnet bildet."); }
  const s = Math.min(im.naturalWidth, im.naturalHeight); const c = document.createElement("canvas"); c.width = c.height = 400;
  c.getContext("2d").drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 400, 400); URL.revokeObjectURL(u);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
  const path = `${me.id}/avatar-${Date.now()}.jpg`;
  const up = await sb.storage.from("media").upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) return toast("Kunne ikke laste opp bildet.");
  const old = me.profile.avatar_path;
  await sb.from("profiles").update({ avatar_path: path }).eq("id", me.id);
  if (old) sb.storage.from("media").remove([old]);
  const { data } = await sb.storage.from("media").createSignedUrl(path, 60 * 60 * 6);
  urls[path] = data?.signedUrl; me.profile.avatar_path = path; profiles[me.id] = me.profile;
  paintAv($("me-av"), me.profile); toast("Profilbildet er oppdatert");
};
$("show-install").onclick = () => { $("me").hidden = true; show("install"); $("install-done").onclick = () => startApp(); };
$("logout").onclick = async () => {
  const sub = await currentSub();
  if (sub) { await sb.rpc("remove_push", { e: sub.endpoint }); await sub.unsubscribe().catch(() => {}); }
  if (channel) { sb.removeChannel(channel); channel = null; }
  await sb.auth.signOut(); me = null; urls = {}; showAuth("login");
};

/* ---------- Admin ---------- */
const inviteUrl = code => `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`;
async function loadAdmin(makeNew = false) {
  const { data: code, error } = await sb.rpc("admin_invite", { make_new: makeNew });
  $("invite-link").textContent = error ? "Fikk ikke hentet lenken." : inviteUrl(code);
  const list = Object.values(profiles).sort((a, b) => a.display_name.localeCompare(b.display_name, "nb"));
  const { data: all } = await sb.from("profiles").select("*");
  (all || list).forEach(p => profiles[p.id] = p);
  $("members").innerHTML = Object.values(profiles).sort((a, b) => a.display_name.localeCompare(b.display_name, "nb")).map(p => `
    <li>${avHtml(p)}<span>${esc(p.display_name)}${p.is_admin ? "<small>Admin</small>" : p.blocked ? "<small>Sperret</small>" : ""}</span>
    ${p.id === me.id ? "" : `<button type="button" data-block="${p.id}" data-b="${!p.blocked}">${p.blocked ? "Slipp inn" : "Fjern"}</button>`}</li>`).join("");
}
$("invite-copy").onclick = async () => {
  const t = $("invite-link").textContent;
  try { await navigator.clipboard.writeText(t); toast("Lenken er kopiert"); }
  catch { const r = document.createRange(); r.selectNodeContents($("invite-link")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("Marker og kopier lenken"); }
};
$("invite-share").onclick = async () => {
  const url = $("invite-link").textContent;
  const text = "Bli med i KOMP, familiens egen bildedeling! Trykk på lenken og lag en bruker:";
  if (navigator.share) {
    try { await navigator.share({ title: "KOMP", text, url }); } catch { /* avbrutt */ }
  } else {
    try { await navigator.clipboard.writeText(text + " " + url); toast("Meldingen er kopiert, lim den inn i en SMS"); }
    catch { toast("Kopier lenken over og send den på SMS"); }
  }
};
$("invite-new").onclick = async () => {
  if (!confirm("Lage ny lenke? Den gamle slutter å virke for nye brukere.")) return;
  await loadAdmin(true); toast("Ny lenke er laget");
};
$("members").addEventListener("click", async e => {
  const b = e.target.closest("[data-block]"); if (!b) return;
  const block = b.dataset.b === "true";
  const name = profiles[b.dataset.block]?.display_name;
  if (block && !confirm(`Fjerne ${name} fra KOMP? Personen kommer ikke inn lenger.`)) return;
  const { error } = await sb.rpc("admin_set_blocked", { uid: b.dataset.block, b: block });
  if (error) return toast("Kunne ikke endre tilgangen.");
  await loadAdmin(); toast(block ? `${name} er fjernet` : `${name} er sluppet inn igjen`);
});

/* ---------- oppstart ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY" && session) {
    enter(session).then(() => { openMe(); toast("Skriv inn et nytt passord"); $("pw-in").focus(); });
  }
});

(async () => {
  if (CFG.supabaseUrl.includes("DITT-PROSJEKT")) {
    showAuth("msg"); $("msg-text").textContent = "KOMP er ikke satt opp ennå. Fyll inn Supabase-adressen og nøkkelen i config.js."; return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session && !location.hash.includes("type=recovery")) await enter(session);
  else if (!session) showAuth(inviteFromUrl ? "signup" : "login");
})();
