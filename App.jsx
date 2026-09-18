import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Home, Search, Users, Trophy, User, X, Check, ChevronRight,
  Filter, ArrowLeft, Edit3, Eye, EyeOff, LogOut, Mail, Lock, MessageCircle, Send, Download,
} from "lucide-react";

/* ===================================================================
   DATA LAYER
   -------------------------------------------------------------------
   Everything below (seedPlayers, seedSquads, seedRequests) is
   in-memory mock data. All reads/writes happen through the handler
   functions inside <App>, already shaped like real backend calls
   (create, update, accept/reject, leave). Swapping this for a real
   service later — auth, a database, a websocket layer for live squad
   status, push notifications, in-app messaging — mainly means
   replacing the internals of those handlers; the component tree and
   data shapes below can stay the same.
=================================================================== */

const ROLES = [
  { id: "igl", label: "IGL", sub: "In-Game Leader", emoji: "🧠" },
  { id: "rusher", label: "Rusher", sub: "Entry Fragger", emoji: "⚡" },
  { id: "support", label: "Support", sub: "Support", emoji: "🛡️" },
  { id: "sniper", label: "Sniper", sub: "Sniper", emoji: "🎯" },
];
const roleById = Object.fromEntries(ROLES.map((r) => [r.id, r]));

const RANKS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Heroic", "Grandmaster"];
const REGIONS = ["NA", "EU", "SA", "MEA", "Asia", "India", "Bangladesh"];
const LANGUAGES = ["English", "Hindi", "Portuguese", "Spanish", "Arabic", "Bangla"];
const PLAYSTYLES = ["Aggressive", "Tactical", "Passive", "Balanced"];
const AVAILABILITY = ["Morning", "Afternoon", "Evening", "Night", "Flexible"];
const EMBLEMS = ["🛡️", "⚔️", "🔥", "🐺", "🦅", "👑", "💀", "⚡", "🌙", "🦂"];
const LFG_STATUSES = [
  { id: "looking", label: "Looking for Squad", emoji: "🟢" },
  { id: "away", label: "Away", emoji: "🟡" },
  { id: "inMatch", label: "In Match", emoji: "🔴" },
  { id: "offline", label: "Offline", emoji: "⚫" },
];
const lfgById = Object.fromEntries(LFG_STATUSES.map((s) => [s.id, s]));

const RANK_COLORS = {
  Bronze: "text-orange-300",
  Silver: "text-slate-300",
  Gold: "text-amber-300",
  Platinum: "text-cyan-300",
  Diamond: "text-sky-300",
  Heroic: "text-violet-300",
  Grandmaster: "text-fuchsia-300",
};

const GRADIENTS = [
  "from-violet-500 to-indigo-500",
  "from-cyan-400 to-blue-500",
  "from-rose-400 to-orange-400",
  "from-emerald-400 to-teal-500",
  "from-fuchsia-500 to-purple-600",
  "from-amber-400 to-rose-500",
];

function gradientFor(seed) {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}
function initials(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
}
function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n).trim() + "…" : str;
}
function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function haptic(pattern = 8) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) { /* unsupported, ignore */ }
  }
}
function isSquadComplete(squad) {
  return Object.values(squad.slots).every(Boolean);
}
function missingRoles(squad) {
  return ROLES.map((r) => r.id).filter((id) => !squad.slots[id]);
}
function playerIsInAnySquad(playerId, squadsList, excludeSquadId) {
  return squadsList.some((s) => s.id !== excludeSquadId && (s.leaderId === playerId || Object.values(s.slots).includes(playerId)));
}
function inviteStateFor(player, mySquad) {
  if (!mySquad) return "no-squad";
  const filled = Object.values(mySquad.slots).filter(Boolean).length;
  if (filled >= 4) return "full";
  if (mySquad.slots[player.role]) return "role-filled";
  return "invite";
}

/* ===================================================================
   MATCHING / COMPATIBILITY
   -------------------------------------------------------------------
   One scoring function, reused by Auto-Fill, squad compatibility
   badges, and Find My Squad, so "why is this a good match" always
   means the same thing across the app. Weighted toward role (the
   actual need) and rank closeness; region/language/playstyle/
   availability add supporting points; an active LFG status is a
   small bonus. Never touches auth data — only gaming-profile fields
   already shown elsewhere in the app.
=================================================================== */
function computeCompatibility(player, criteria) {
  let score = 0;
  let maxScore = 0;
  const reasons = [];

  maxScore += 30;
  if (criteria.role) {
    if (player.role === criteria.role) { score += 30; reasons.push(`Needed role: ${roleById[player.role].label}`); }
    else reasons.push(`${roleById[player.role].label} not currently needed`);
  }

  maxScore += 20;
  if (criteria.rank) {
    const dist = Math.abs(RANKS.indexOf(player.rank) - RANKS.indexOf(criteria.rank));
    if (RANKS.indexOf(player.rank) !== -1) {
      score += Math.max(0, 20 - dist * 5);
      if (dist === 0) reasons.push("Same rank tier");
      else if (dist === 1) reasons.push("Compatible rank");
    }
  }

  maxScore += 15;
  if (criteria.region && player.region === criteria.region) { score += 15; reasons.push("Same region"); }

  maxScore += 15;
  if (criteria.language && player.language === criteria.language) { score += 15; reasons.push("Same language"); }

  maxScore += 10;
  if (criteria.playstyle && player.playstyle === criteria.playstyle) { score += 10; reasons.push("Similar playstyle"); }

  maxScore += 10;
  if (criteria.availability && player.availability === criteria.availability) { score += 10; reasons.push("Same availability"); }

  maxScore += 5;
  if (player.lfgStatus === "looking") { score += 5; reasons.push("Actively looking for a squad"); }

  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  return { pct: Math.max(0, Math.min(100, pct)), reasons };
}

// Criteria for "how well does a player fit this squad" — proxies the
// squad's culture off its leader's own profile, since squads don't
// store their own language/playstyle/availability.
function squadCriteria(squad, players, roleOverride) {
  const leader = players.find((p) => p.id === squad.leaderId);
  return {
    role: roleOverride || null,
    rank: squad.rankTier,
    region: squad.region,
    language: leader ? leader.language : null,
    playstyle: leader ? leader.playstyle : null,
    availability: leader ? leader.availability : null,
  };
}

function compatibilityForSquad(player, squad, players) {
  const missing = missingRoles(squad);
  const roleNeeded = missing.includes(player.role) ? player.role : null;
  return computeCompatibility(player, squadCriteria(squad, players, roleNeeded));
}

// Ranked, scored candidates for one open role on a squad — the shared
// list Auto-Fill and the manual slot picker both render.
function rankedCandidatesForRole(squad, roleId, players) {
  const usedIds = new Set(Object.values(squad.slots).filter(Boolean));
  const criteria = squadCriteria(squad, players, roleId);
  return players
    .filter((p) => p.role === roleId && !usedIds.has(p.id) && p.id !== squad.leaderId)
    .map((p) => ({ player: p, ...computeCompatibility(p, criteria) }))
    .sort((a, b) => b.pct - a.pct);
}

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setValue(target); return; }
    let start = null;
    let raf;
    function step(ts) {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

let seedPlayers = [
  { id: "p1", ign: "ShadowByte", uid: "5023 1187 220", role: "igl", rank: "Heroic", region: "Asia", language: "English", playstyle: "Tactical", availability: "Evening", bio: "Calling rotations since Season 4. I read the zone, you trust the call.", wins: 214, kills: 1830, mvps: 61, profileComplete: true, lfgStatus: "looking" },
  { id: "p2", ign: "ZeroCool_99", uid: "1188 4471 902", role: "rusher", rank: "Grandmaster", region: "NA", language: "English", playstyle: "Aggressive", availability: "Night", bio: "First one in, last one standing. Entry frags are my love language.", wins: 301, kills: 2790, mvps: 118, lfgStatus: "inMatch" },
  { id: "p3", ign: "NightViper", uid: "9092 2201 774", role: "sniper", rank: "Diamond", region: "EU", language: "English", playstyle: "Passive", availability: "Flexible", bio: "One shot, one drop. Patience wins fights.", wins: 176, kills: 1420, mvps: 44, lfgStatus: "looking" },
  { id: "p4", ign: "PixelQueen", uid: "3345 8820 013", role: "support", rank: "Platinum", region: "SA", language: "Portuguese", playstyle: "Balanced", availability: "Afternoon", bio: "Heals, smokes, and revives on time, every time.", wins: 98, kills: 640, mvps: 19, lfgStatus: "looking" },
  { id: "p5", ign: "RustyAngle", uid: "7712 0093 441", role: "sniper", rank: "Heroic", region: "India", language: "Hindi", playstyle: "Tactical", availability: "Evening", bio: "Long angles, short conversations. Let's win.", wins: 155, kills: 1290, mvps: 37, lfgStatus: "offline" },
  { id: "p6", ign: "VelvetSpectre", uid: "2201 5567 830", role: "igl", rank: "Diamond", region: "MEA", language: "Arabic", playstyle: "Balanced", availability: "Night", bio: "Shotcaller with a plan B for every plan A.", wins: 132, kills: 980, mvps: 28, lfgStatus: "looking" },
  { id: "p7", ign: "KairoDrift", uid: "6634 1120 559", role: "rusher", rank: "Platinum", region: "Bangladesh", language: "Bangla", playstyle: "Aggressive", availability: "Night", bio: "Bike rush enjoyer. I make noise so the squad doesn't have to.", wins: 87, kills: 705, mvps: 15, lfgStatus: "away" },
  { id: "p8", ign: "MoonlitFox", uid: "4488 3302 671", role: "support", rank: "Gold", region: "EU", language: "Spanish", playstyle: "Passive", availability: "Morning", bio: "Loot goblin turned lifesaver. Gloo walls on demand.", wins: 54, kills: 310, mvps: 9, lfgStatus: "inMatch" },
  { id: "p9", ign: "GhostFrame", uid: "8823 4491 002", role: "sniper", rank: "Grandmaster", region: "NA", language: "English", playstyle: "Tactical", availability: "Flexible", bio: "Quiet type, loud kill feed.", wins: 289, kills: 2510, mvps: 103, lfgStatus: "offline" },
  { id: "p10", ign: "EmberQuinn", uid: "1290 7734 118", role: "igl", rank: "Platinum", region: "Asia", language: "English", playstyle: "Balanced", availability: "Evening", bio: "Two years of ranked calling. Clear comms, no ego.", wins: 121, kills: 860, mvps: 22, lfgStatus: "inMatch" },
  { id: "p11", ign: "VoltCipher", uid: "5567 2290 441", role: "rusher", rank: "Diamond", region: "India", language: "Hindi", playstyle: "Aggressive", availability: "Night", bio: "Fast rotations, faster reloads.", wins: 168, kills: 1510, mvps: 41, lfgStatus: "inMatch" },
  { id: "p12", ign: "SilentAurora", uid: "9981 4420 337", role: "support", rank: "Heroic", region: "SA", language: "Portuguese", playstyle: "Balanced", availability: "Afternoon", bio: "Squad medic. Nobody drops on my watch.", wins: 143, kills: 720, mvps: 26, lfgStatus: "offline" },
  { id: "p13", ign: "IronMirage", uid: "3321 8845 109", role: "sniper", rank: "Platinum", region: "MEA", language: "Arabic", playstyle: "Tactical", availability: "Night", bio: "Third-party specialist. I finish what others start.", wins: 76, kills: 690, mvps: 14, lfgStatus: "inMatch" },
  { id: "p14", ign: "CrimsonYuki", uid: "6690 1123 884", role: "rusher", rank: "Gold", region: "Asia", language: "English", playstyle: "Aggressive", availability: "Evening", bio: "Learning fast, hitting hard. Looking for a squad to grow with.", wins: 39, kills: 280, mvps: 6, lfgStatus: "looking" },
  { id: "p15", ign: "NovaHunter", uid: "2245 9987 301", role: "igl", rank: "Grandmaster", region: "EU", language: "English", playstyle: "Tactical", availability: "Flexible", bio: "Top 50 ranked last season. Bring your A-game.", wins: 334, kills: 2210, mvps: 97, lfgStatus: "inMatch" },
  { id: "p16", ign: "WillowStrike", uid: "8871 2093 447", role: "support", rank: "Diamond", region: "NA", language: "English", playstyle: "Balanced", availability: "Morning", bio: "Utility first, kills second. Great with new squads.", wins: 112, kills: 540, mvps: 18, lfgStatus: "away" },
  { id: "p17", ign: "LunarEcho", uid: "4432 8801 552", role: "support", rank: "Silver", region: "EU", language: "English", playstyle: "Balanced", availability: "Flexible", bio: "New to ranked, quick learner, always on comms.", wins: 21, kills: 140, mvps: 3, lfgStatus: "looking" },
  { id: "p18", ign: "AshFang", uid: "7761 2290 887", role: "rusher", rank: "Bronze", region: "NA", language: "English", playstyle: "Aggressive", availability: "Night", bio: "Fearless and a little reckless. Looking for patient teammates.", wins: 9, kills: 88, mvps: 1, lfgStatus: "looking" },
  { id: "p19", ign: "ObsidianTide", uid: "3390 4471 665", role: "sniper", rank: "Gold", region: "Bangladesh", language: "Bangla", playstyle: "Tactical", availability: "Evening", bio: "Holding angles since launch day. Let's climb together.", wins: 63, kills: 510, mvps: 11, lfgStatus: "looking" },
  { id: "p20", ign: "FeatherLynx", uid: "9912 3345 220", role: "igl", rank: "Silver", region: "Asia", language: "English", playstyle: "Balanced", availability: "Morning", bio: "Casual shotcaller, big on good vibes over stats.", wins: 27, kills: 190, mvps: 4, lfgStatus: "away" },
];

let ME_ID = "p1"; // reassigned per-session by handleAuthenticated — see AUTH LAYER below
const DAY = 1000 * 60 * 60 * 24;

function createBlankPlayer(id) {
  return {
    id, ign: "", uid: "", role: ROLES[0].id, rank: RANKS[0], region: REGIONS[0],
    language: LANGUAGES[0], playstyle: PLAYSTYLES[0], availability: AVAILABILITY[0],
    bio: "", wins: 0, kills: 0, mvps: 0, profileComplete: false, lfgStatus: "looking",
  };
}

let seedSquads = [
  { id: "s1", name: "Obsidian Vanguard", logoEmoji: "🛡️", description: "Ranked grinders pushing Grandmaster this split. Calm comms, clear rotations.", region: "Asia", rankTier: "Heroic", leaderId: "p1", slots: { igl: "p1", rusher: "p2", support: null, sniper: null }, wins: 58, createdAt: Date.now() - 46 * DAY, readyState: {}, memberHistory: [
    { playerId: "p1", role: "igl", joinedAt: Date.now() - 46 * DAY, leftAt: null },
    { playerId: "p18", role: "rusher", joinedAt: Date.now() - 40 * DAY, leftAt: Date.now() - 12 * DAY },
    { playerId: "p2", role: "rusher", joinedAt: Date.now() - 10 * DAY, leftAt: null },
  ] },
  { id: "s2", name: "Velvet Nocturne", logoEmoji: "🌙", description: "Late-night squad, chill vibes, serious fights. NA/EU friendly.", region: "NA", rankTier: "Grandmaster", leaderId: "p9", slots: { igl: "p15", rusher: "p11", support: "p16", sniper: "p9" }, wins: 142, createdAt: Date.now() - 120 * DAY, readyState: {}, memberHistory: [
    { playerId: "p9", role: "sniper", joinedAt: Date.now() - 120 * DAY, leftAt: null },
    { playerId: "p15", role: "igl", joinedAt: Date.now() - 118 * DAY, leftAt: null },
    { playerId: "p11", role: "rusher", joinedAt: Date.now() - 95 * DAY, leftAt: null },
    { playerId: "p16", role: "support", joinedAt: Date.now() - 60 * DAY, leftAt: null },
  ] },
  { id: "s3", name: "Iron Halo", logoEmoji: "⚔️", description: "Building a Diamond+ roster for weekend scrims.", region: "MEA", rankTier: "Diamond", leaderId: "p6", slots: { igl: "p6", rusher: null, support: null, sniper: "p13" }, wins: 34, createdAt: Date.now() - 22 * DAY, readyState: {}, memberHistory: [
    { playerId: "p6", role: "igl", joinedAt: Date.now() - 22 * DAY, leftAt: null },
    { playerId: "p13", role: "sniper", joinedAt: Date.now() - 15 * DAY, leftAt: null },
  ] },
  { id: "s4", name: "Paper Tigers", logoEmoji: "🐯", description: "New squad, big ambitions. Looking for a full roster.", region: "SA", rankTier: "Platinum", leaderId: "p4", slots: { igl: null, rusher: null, support: "p4", sniper: null }, wins: 6, createdAt: Date.now() - 5 * DAY, readyState: {}, memberHistory: [
    { playerId: "p4", role: "support", joinedAt: Date.now() - 5 * DAY, leftAt: null },
  ] },
  { id: "s5", name: "Solstice Kings", logoEmoji: "👑", description: "Full roster, scrim-ready. Not currently recruiting.", region: "India", rankTier: "Heroic", leaderId: "p5", slots: { igl: "p10", rusher: "p14", support: "p12", sniper: "p5" }, wins: 97, createdAt: Date.now() - 200 * DAY, readyState: {}, memberHistory: [
    { playerId: "p5", role: "sniper", joinedAt: Date.now() - 200 * DAY, leftAt: null },
    { playerId: "p10", role: "igl", joinedAt: Date.now() - 190 * DAY, leftAt: null },
    { playerId: "p12", role: "support", joinedAt: Date.now() - 150 * DAY, leftAt: null },
    { playerId: "p14", role: "rusher", joinedAt: Date.now() - 80 * DAY, leftAt: null },
  ] },
  { id: "s6", name: "Static Bloom", logoEmoji: "⚡", description: "Casual-competitive mix, big on comms and good vibes.", region: "EU", rankTier: "Diamond", leaderId: "p3", slots: { igl: null, rusher: "p7", support: "p8", sniper: "p3" }, wins: 41, createdAt: Date.now() - 33 * DAY, readyState: {}, memberHistory: [
    { playerId: "p3", role: "sniper", joinedAt: Date.now() - 33 * DAY, leftAt: null },
    { playerId: "p7", role: "rusher", joinedAt: Date.now() - 28 * DAY, leftAt: null },
    { playerId: "p8", role: "support", joinedAt: Date.now() - 20 * DAY, leftAt: null },
  ] },
];

let seedRequests = [
  { id: "r1", squadId: "s1", playerId: "p19", role: "sniper", status: "pending" },
];

let seedRecruitmentPosts = [
  { id: "rp1", squadId: "s1", roles: ["support", "sniper"], minRank: "Diamond", language: "English", region: "Asia", availability: "Evening", playstyle: "Tactical", description: "Pushing Heroic into Grandmaster this split. Need calm, communicative players who can hold rotations.", status: "open", createdAt: Date.now() - 20 * 60 * 60 * 1000 },
  { id: "rp2", squadId: "s4", roles: ["igl", "rusher", "sniper"], minRank: "Silver", language: "Portuguese", region: "SA", availability: "Afternoon", playstyle: "Balanced", description: "Brand new squad, just getting started. Friendly, low-pressure vibes.", status: "open", createdAt: Date.now() - 5 * 60 * 60 * 1000 },
];

/* ===================================================================
   STORAGE ABSTRACTION
   -------------------------------------------------------------------
   One key-value store, tried in this order:
   1. Capacitor Preferences — real native storage once this is packaged
      for Android. Reached through window.Capacitor.Plugins so this
      file never needs a static `@capacitor/preferences` import (which
      would fail to resolve in the Claude.ai artifact preview).
   2. window.storage — the Claude.ai artifact preview's own store.
   3. localStorage — any other real browser (e.g. `npm run dev`).
   4. An in-memory Map, so the app never throws — it just won't
      remember anything past this session.
   Never used for passwords or auth secrets; those belong to a real
   auth provider, never to local storage.
=================================================================== */

const memoryStore = new Map();

function getPreferencesPlugin() {
  return (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
}

async function storageGet(key) {
  try {
    const prefs = getPreferencesPlugin();
    if (prefs) { const { value } = await prefs.get({ key }); return value; }
    if (typeof window !== "undefined" && window.storage) { const res = await window.storage.get(key); return res ? res.value : null; }
    if (typeof window !== "undefined" && window.localStorage) { return window.localStorage.getItem(key); }
  } catch (e) { /* fall through to memory */ }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}
async function storageSet(key, value) {
  try {
    const prefs = getPreferencesPlugin();
    if (prefs) { await prefs.set({ key, value }); return; }
    if (typeof window !== "undefined" && window.storage) { await window.storage.set(key, value); return; }
    if (typeof window !== "undefined" && window.localStorage) { window.localStorage.setItem(key, value); return; }
  } catch (e) { /* fall through to memory */ }
  memoryStore.set(key, value);
}
async function storageRemove(key) {
  try {
    const prefs = getPreferencesPlugin();
    if (prefs) { await prefs.remove({ key }); return; }
    if (typeof window !== "undefined" && window.storage) { await window.storage.delete(key); return; }
    if (typeof window !== "undefined" && window.localStorage) { window.localStorage.removeItem(key); return; }
  } catch (e) { /* fall through */ }
  memoryStore.delete(key);
}

/* ===================================================================
   AUTH LAYER (prototype only)
   -------------------------------------------------------------------
   No real backend: signing up or logging in only checks that the
   fields are filled in validly, then stores a lightweight session
   marker so the person stays "logged in" after a restart. Nothing
   here verifies a real identity, hashes a password, or protects
   against tampering — this is a frontend prototype, not real auth.
   AuthProvider is the one place that would talk to a real backend
   later (Firebase Auth, Supabase Auth, or a custom API); the UI only
   ever calls these methods, and Google sign-in / password reset are
   left as clearly-marked integration points rather than faked.
=================================================================== */

const SESSION_KEY = "sqf-session";
const ACCOUNTS_KEY = "sqf-accounts";
const APP_DATA_KEY = "sqf-app-data";

async function loadSession() {
  try {
    const raw = await storageGet(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // Sessions saved before profile setup existed have no profileComplete
    // field — treat those as already complete rather than surprising a
    // returning tester with a new gate they never had before.
    if (s && typeof s.profileComplete === "undefined") s.profileComplete = true;
    // Sessions saved before per-account identity existed have no playerId —
    // those all implicitly meant the original seeded player.
    if (s && !s.playerId) s.playerId = "p1";
    return s;
  } catch (e) {
    return null;
  }
}
async function persistSession(session) {
  try { await storageSet(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* best-effort in this prototype */ }
}
async function clearPersistedSession() {
  try { await storageRemove(SESSION_KEY); } catch (e) { /* best-effort in this prototype */ }
}

// Maps email -> playerId so the same account always comes back to the same
// player record, and a new email gets its own. No real backend: this is
// just a local device-side registry, not account verification.
async function resolvePlayerIdForEmail(email) {
  let registry = {};
  try {
    const raw = await storageGet(ACCOUNTS_KEY);
    registry = raw ? JSON.parse(raw) : {};
  } catch (e) { /* start fresh */ }
  if (registry[email]) return { playerId: registry[email], isNew: false };
  const playerId = "u" + Math.random().toString(36).slice(2, 8);
  registry[email] = playerId;
  try { await storageSet(ACCOUNTS_KEY, JSON.stringify(registry)); } catch (e) { /* best-effort in this prototype */ }
  return { playerId, isNew: true };
}

// Players/squads/requests/recruitment posts — the app's actual data, kept
// separate from the session/chat stores above so each can load/save
// independently.
async function loadAppData() {
  try {
    const raw = await storageGet(APP_DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
async function persistAppData(data) {
  try { await storageSet(APP_DATA_KEY, JSON.stringify(data)); } catch (e) { /* best-effort in this prototype */ }
}

const AuthProvider = {
  // No real backend to check credentials against — this resolves (or
  // creates) a local player identity for the email and shapes a session
  // around it. Swap the internals for a real provider later; it should
  // still resolve to a stable playerId per real account.
  async signUp(email, password) {
    const { playerId, isNew } = await resolvePlayerIdForEmail(email.trim());
    return { type: "account", email: email.trim(), playerId, isNew };
  },
  async logIn(email, password) {
    const { playerId, isNew } = await resolvePlayerIdForEmail(email.trim());
    return { type: "account", email: email.trim(), playerId, isNew };
  },
  async continueWithGoogle() {
    throw new Error("Google sign-in requires a connected auth provider (e.g. Firebase Auth or Supabase Auth) — not wired up yet.");
  },
  async requestPasswordReset(email) {
    throw new Error("Password reset requires a connected auth provider — not wired up yet.");
  },
};

/* ===================================================================
   SQUAD CHAT LAYER (prototype only)
   -------------------------------------------------------------------
   Each squad's chat is just its messages filtered by squadId — access
   is enforced by checking current squad membership before rendering
   the chat screen, not by anything server-side (there is no server).
   Messages persist via this artifact's window.storage API so a
   refresh doesn't lose them. To connect a real backend later (e.g.
   Firebase/Supabase), replace loadChatData/persistChatData with real
   reads/writes and swap the polling-free local state for a live
   subscription — the rest of the UI already just renders `messages`.
=================================================================== */

const CHAT_KEY = "sqf-chat-data";

let seedMessages = [
  { id: "m1", squadId: "s1", senderId: "p2", text: "Ready when you are — just need a Support and a Sniper.", ts: Date.now() - 1000 * 60 * 42 },
  { id: "m2", squadId: "s1", senderId: "p2", text: "Should we run a scrim tonight if we fill the roster?", ts: Date.now() - 1000 * 60 * 20 },
];

async function loadChatData() {
  try {
    const raw = await storageGet(CHAT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
async function persistChatData(data) {
  try { await storageSet(CHAT_KEY, JSON.stringify(data)); } catch (e) { /* best-effort in this prototype */ }
}

/* ===================================================================
   UPDATE SYSTEM (prototype architecture)
   -------------------------------------------------------------------
   CURRENT_APP_VERSION is the single source of truth for this build.
   UPDATE_MANIFEST_URL is left blank on purpose — this file never ships
   a fake/placeholder URL that looks like a real working endpoint.
   Point it at a real hosted JSON file (matching the shape below) when
   one exists; nothing else needs to change.

   Expected manifest shape:
   {
     "latestVersion": "1.1.0",
     "apkUrl": "https://example.com/squad-finder.apk",
     "changelog": ["Improved Squad Chat", "New squad features", "Bug fixes"],
     "forceUpdate": false
   }

   UpdateProvider is the only place that talks to the outside world for
   updates. Swap its internals for a real backend later (Firebase and
   paid services intentionally not used here) — the UI below only ever
   calls these two methods.
=================================================================== */

const CURRENT_APP_VERSION = "1.0.0";
const UPDATE_MANIFEST_URL = "";

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// True only inside a real Capacitor-wrapped Android app. Always false
// in this browser preview, by design.
function isNativeAndroid() {
  return (
    typeof window !== "undefined" &&
    !!window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform() &&
    typeof window.Capacitor.getPlatform === "function" &&
    window.Capacitor.getPlatform() === "android"
  );
}

const UpdateProvider = {
  async checkForUpdate() {
    if (!UPDATE_MANIFEST_URL) return { status: "unconfigured" };
    try {
      const res = await fetch(UPDATE_MANIFEST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("Manifest request failed (" + res.status + ")");
      const manifest = await res.json();
      if (!manifest || typeof manifest.latestVersion !== "string") throw new Error("Manifest is missing latestVersion");
      const hasUpdate = compareVersions(manifest.latestVersion, CURRENT_APP_VERSION) > 0;
      return hasUpdate ? { status: "available", manifest } : { status: "up-to-date" };
    } catch (e) {
      return { status: "error", message: (e && e.message) || "Update check failed" };
    }
  },

  // Real download + install requires the Android/Capacitor build.
  // Deliberately does nothing fake in a browser preview — Android's
  // own installer must always be the thing that asks the user to
  // confirm the install; this never attempts to bypass that.
  async downloadAndInstall(manifest, onProgress) {
    if (!isNativeAndroid()) {
      throw new Error("Downloading and installing an update is only available in the packaged Android app.");
    }
    // --- Capacitor integration point (not implemented yet) ---
    // e.g. using @capacitor/filesystem to download manifest.apkUrl
    // with progress reported through onProgress(0-100), then handing
    // the downloaded file to a native installer plugin/intent so
    // Android shows its own install confirmation UI.
    throw new Error("Android update installer is not wired up yet — connect a Capacitor download/install plugin here.");
  },
};

/* ===================================================================
   UI PRIMITIVES
=================================================================== */

function Badge({ children, className = "" }) {
  const hasColor = className.includes("text-");
  return (
    <span className={`sqf-glass rounded-full px-2.5 py-1 text-xs font-medium ${hasColor ? "" : "text-white/70"} ${className}`}>
      {children}
    </span>
  );
}

function Avatar({ player, size = 40 }) {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradientFor(player.id)} font-semibold text-white shadow-md`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
    >
      {initials(player.ign)}
      <span
        className="absolute flex items-center justify-center rounded-full bg-zinc-900 ring-2 ring-zinc-950"
        style={{ width: size * 0.44, height: size * 0.44, fontSize: size * 0.24, bottom: -2, right: -2 }}
      >
        {roleById[player.role].emoji}
      </span>
    </div>
  );
}

function SquadLogo({ squad, size = 48 }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradientFor(squad.id)} shadow-lg`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {squad.logoEmoji}
    </div>
  );
}

function StatusPill({ complete }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${complete ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
      <span>{complete ? "🟢" : "🔴"}</span>
      <span>{complete ? "Squad Complete" : "Looking for Players"}</span>
    </span>
  );
}

function CompatibilityBadge({ pct, size = "md" }) {
  const color = pct >= 80 ? "text-emerald-300" : pct >= 50 ? "text-amber-300" : "text-white/50";
  if (size === "sm") {
    return <Badge className={color}>{pct}% Match</Badge>;
  }
  return <div className={`sqf-display text-2xl font-bold ${color}`}>{pct}% Squad Match</div>;
}

function CompatibilityReasons({ reasons }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.slice(0, 4).map((r, i) => <Badge key={i}>{r}</Badge>)}
    </div>
  );
}

function LfgDot({ status }) {
  const s = lfgById[status] || LFG_STATUSES[3];
  return <span title={s.label}>{s.emoji}</span>;
}

function PageHeader({ title, subtitle }) {
  return (
    <div>
      <h1 className="sqf-display text-3xl font-bold text-white">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-white/45">{subtitle}</p>}
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle, small }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${small ? "py-6" : "py-16"}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-white/30">
        <Icon size={20} />
      </div>
      <div className="mt-3 text-sm font-medium text-white/70">{title}</div>
      {subtitle && <div className="mt-1 text-xs text-white/40">{subtitle}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mt-5">
      <label className="mb-2 block text-sm font-medium text-white/70">{label}</label>
      {children}
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="sqf-glass rounded-2xl p-4">
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-1 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function QuickChip({ active, onClick, children }) {
  return (
    <button
      onClick={() => { haptic(6); onClick(); }}
      className={`sqf-press sqf-focus shrink-0 rounded-full px-4 py-2.5 text-sm font-medium ${active ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white" : "sqf-glass text-white/60"}`}
    >
      {children}
    </button>
  );
}

function PlayerCardSkeleton() {
  return (
    <div className="sqf-glass rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <div className="sqf-skeleton h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="sqf-skeleton h-3 w-24 rounded-full" />
          <div className="sqf-skeleton h-3 w-32 rounded-full" />
        </div>
      </div>
      <div className="mt-3 sqf-skeleton h-8 w-full rounded-xl" />
    </div>
  );
}

function SquadCardSkeleton() {
  return (
    <div className="sqf-glass rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <div className="sqf-skeleton h-12 w-12 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <div className="sqf-skeleton h-3 w-28 rounded-full" />
          <div className="sqf-skeleton h-3 w-20 rounded-full" />
        </div>
      </div>
      <div className="mt-3 sqf-skeleton h-16 w-full rounded-xl" />
    </div>
  );
}

/* ===================================================================
   OVERLAYS: Sheet, Modal, Toasts
=================================================================== */

function Sheet({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sqf-glass-strong sqf-sheet-in sqf-safe-bottom w-full max-w-md overflow-y-auto rounded-t-3xl p-6 sqf-scroll"
        style={{ maxHeight: "85vh" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        {children}
      </div>
    </div>
  );
}

function Modal({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sqf-glass-strong sqf-modal-in w-full max-w-md overflow-y-auto rounded-3xl p-6 sqf-scroll"
        style={{ maxHeight: "85vh" }}
      >
        {children}
      </div>
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="pointer-events-none fixed top-0 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pt-4">
      {toasts.map((t) => (
        <div key={t.id} className="sqf-glass-strong sqf-toast-in pointer-events-auto rounded-full px-4 py-2.5 shadow-xl">
          <span className="text-sm font-medium text-white">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function FilterSheet({ open, onClose, filters, setFilters, groups }) {
  if (!open) return null;
  const activeCount = Object.values(filters).filter(Boolean).length;
  return (
    <Sheet onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="sqf-display text-lg font-bold text-white">Filters</h3>
        {activeCount > 0 && (
          <button
            onClick={() => setFilters(Object.fromEntries(Object.keys(filters).map((k) => [k, ""])))}
            className="text-sm text-violet-300"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-2 text-sm font-medium text-white/60">{g.label}</div>
            <div className="flex flex-wrap gap-2">
              {g.options.map((opt) => {
                const active = filters[g.key] === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => { haptic(6); setFilters((f) => ({ ...f, [g.key]: active ? "" : opt.value })); }}
                    className={`sqf-press sqf-focus rounded-full px-3.5 py-2 text-sm font-medium ${active ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white" : "sqf-glass text-white/60"}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button onClick={onClose} className="sqf-press sqf-focus mt-6 w-full rounded-2xl bg-white/10 py-3.5 text-sm font-semibold text-white">
        Done
      </button>
    </Sheet>
  );
}

function SlotPickerModal({ squad, roleId, players, onPick, onClose }) {
  const role = roleById[roleId];
  const candidates = rankedCandidatesForRole(squad, roleId, players);
  return (
    <Modal onClose={onClose}>
      <h3 className="sqf-display text-lg font-bold text-white">Add {role.label}</h3>
      <p className="mt-1 text-sm text-white/45">{role.emoji} {role.sub} · ranked by compatibility</p>
      <div className="mt-4 max-h-80 space-y-2 overflow-y-auto sqf-scroll">
        {candidates.length === 0 ? (
          <div className="py-6 text-center text-sm text-white/40">No available {role.label}s right now.</div>
        ) : (
          candidates.map(({ player: p, pct }) => (
            <button key={p.id} onClick={() => onPick(p.id)} className="sqf-press sqf-focus flex w-full items-center gap-3 rounded-2xl sqf-glass p-3 text-left">
              <Avatar player={p} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-sm font-medium text-white">{p.ign}</div>
                  <LfgDot status={p.lfgStatus} />
                </div>
                <div className={`text-xs ${RANK_COLORS[p.rank]}`}>{p.rank}</div>
              </div>
              <CompatibilityBadge pct={pct} size="sm" />
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

/* Shows the best-ranked candidate(s) for every currently-empty role at
   once. Never adds anyone automatically — every invite still needs an
   explicit tap from the leader. */
function AutoFillModal({ squad, players, onInvite, onClose }) {
  const missing = missingRoles(squad);
  return (
    <Modal onClose={onClose}>
      <h3 className="sqf-display text-lg font-bold text-white">Auto-Fill Missing Roles</h3>
      <p className="mt-1 text-sm text-white/45">Top matches for each open slot — you choose who to invite.</p>
      <div className="mt-4 max-h-96 space-y-5 overflow-y-auto sqf-scroll">
        {missing.length === 0 ? (
          <div className="py-6 text-center text-sm text-white/40">This squad is already complete.</div>
        ) : (
          missing.map((roleId) => {
            const role = roleById[roleId];
            const top = rankedCandidatesForRole(squad, roleId, players).slice(0, 3);
            return (
              <div key={roleId}>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-white/70">
                  <span>{role.emoji}</span> {role.label}
                </div>
                {top.length === 0 ? (
                  <div className="rounded-xl bg-white/5 p-3 text-xs text-white/40">No available {role.label}s right now.</div>
                ) : (
                  <div className="space-y-2">
                    {top.map(({ player: p, pct, reasons }) => (
                      <div key={p.id} className="sqf-glass rounded-2xl p-3">
                        <div className="flex items-center gap-3">
                          <Avatar player={p} size={40} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <div className="truncate text-sm font-medium text-white">{p.ign}</div>
                              <LfgDot status={p.lfgStatus} />
                            </div>
                            <div className={`text-xs ${RANK_COLORS[p.rank]}`}>{p.rank}</div>
                          </div>
                          <CompatibilityBadge pct={pct} size="sm" />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <CompatibilityReasons reasons={reasons} />
                        </div>
                        <button
                          onClick={() => onInvite(roleId, p.id)}
                          className="sqf-press sqf-focus mt-3 w-full rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 py-2 text-sm font-medium text-white"
                        >
                          Invite {p.ign}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

/* Create or edit a squad's recruitment post. Leader-only — App only
   ever opens this from a leader-gated button. */
function RecruitmentPostModal({ squad, existingPost, onSave, onClose }) {
  const availableRoles = missingRoles(squad);
  const [roles, setRoles] = useState(
    existingPost ? existingPost.roles.filter((r) => availableRoles.includes(r)) : availableRoles
  );
  const [minRank, setMinRank] = useState(existingPost ? existingPost.minRank : squad.rankTier);
  const [language, setLanguage] = useState(existingPost ? existingPost.language : LANGUAGES[0]);
  const [region, setRegion] = useState(existingPost ? existingPost.region : squad.region);
  const [availability, setAvailability] = useState(existingPost ? existingPost.availability : AVAILABILITY[0]);
  const [playstyle, setPlaystyle] = useState(existingPost ? existingPost.playstyle : PLAYSTYLES[0]);
  const [description, setDescription] = useState(existingPost ? existingPost.description : "");

  function toggleRole(id) {
    if (!availableRoles.includes(id)) return;
    haptic(6);
    setRoles((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  function handleSave() {
    if (roles.length === 0) return;
    onSave({ roles, minRank, language, region, availability, playstyle, description: description.trim() });
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="sqf-display text-lg font-bold text-white">{existingPost ? "Edit Recruitment Post" : "Create Recruitment Post"}</h3>

      <Field label="Roles Needed">
        <div className="flex flex-wrap gap-2">
          {availableRoles.length === 0 ? (
            <div className="text-xs text-white/40">No open roles to advertise — this squad is full.</div>
          ) : (
            availableRoles.map((roleId) => {
              const r = roleById[roleId];
              return (
                <button
                  key={r.id}
                  onClick={() => toggleRole(r.id)}
                  className={`sqf-press rounded-full px-3.5 py-2 text-sm font-medium ${roles.includes(r.id) ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white" : "sqf-glass text-white/60"}`}
                >
                  {r.emoji} {r.label}
                </button>
              );
            })
          )}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum Rank">
          <select value={minRank} onChange={(e) => setMinRank(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {RANKS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
        <Field label="Region">
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {REGIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
        <Field label="Language">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {LANGUAGES.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
        <Field label="Availability">
          <select value={availability} onChange={(e) => setAvailability(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {AVAILABILITY.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Playstyle">
        <select value={playstyle} onChange={(e) => setPlaystyle(e.target.value)} className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white outline-none sqf-focus">
          {PLAYSTYLES.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
        </select>
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What are you looking for?"
          className="sqf-glass w-full resize-none rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none sqf-focus"
        />
      </Field>

      <button
        onClick={handleSave}
        disabled={roles.length === 0}
        className="sqf-press sqf-focus mt-6 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {existingPost ? "Save Changes" : "Create Post"}
      </button>
    </Modal>
  );
}

function PlayerSheet({ player, onClose, onInvite, inviteState }) {
  const role = roleById[player.role];
  const labelFor = { invite: "Invite to Squad", "role-filled": "Role Filled in Your Squad", full: "Your Squad Is Full", "no-squad": "Create a Squad First" };
  return (
    <Sheet onClose={onClose}>
      <div className="text-center">
        <div className="mx-auto"><Avatar player={player} size={80} /></div>
        <h2 className="sqf-display mt-3 text-xl font-bold text-white">{player.ign}</h2>
        <div className="mt-1 text-xs text-white/40">UID {player.uid}</div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <Badge>{role.emoji} {role.label}</Badge>
          <Badge className={RANK_COLORS[player.rank]}>{player.rank}</Badge>
          <Badge>{player.region}</Badge>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-white/60">{player.bio}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-left">
          <InfoTile label="Playstyle" value={player.playstyle} />
          <InfoTile label="Language" value={player.language} />
          <InfoTile label="Availability" value={player.availability} />
          <InfoTile label="Wins" value={player.wins.toLocaleString()} />
        </div>
        {inviteState && (
          <button
            onClick={inviteState === "invite" ? onInvite : undefined}
            disabled={inviteState !== "invite"}
            className={`sqf-press sqf-focus mt-5 w-full rounded-2xl py-3.5 text-sm font-semibold ${inviteState === "invite" ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-500/30" : "bg-white/5 text-white/30"}`}
          >
            {labelFor[inviteState]}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function EditProfileModal({ me, onSave, onClose }) {
  const [ign, setIgn] = useState(me.ign);
  const [uid, setUid] = useState(me.uid);
  const [rank, setRank] = useState(me.rank);
  const [region, setRegion] = useState(me.region);
  const [role, setRole] = useState(me.role);
  const [playstyle, setPlaystyle] = useState(me.playstyle);
  const [language, setLanguage] = useState(me.language);
  const [availability, setAvailability] = useState(me.availability);
  const [bio, setBio] = useState(me.bio);

  return (
    <Modal onClose={onClose}>
      <h3 className="sqf-display text-lg font-bold text-white">Edit Profile</h3>
      <Field label="IGN">
        <input value={ign} onChange={(e) => setIgn(e.target.value)} className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white outline-none sqf-focus" />
      </Field>
      <Field label="Free Fire UID">
        <input value={uid} onChange={(e) => setUid(e.target.value)} className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white outline-none sqf-focus" />
      </Field>
      <Field label="Preferred Role">
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button key={r.id} onClick={() => { haptic(6); setRole(r.id); }} className={`sqf-press rounded-2xl sqf-glass p-3 text-left ${role === r.id ? "ring-2 ring-violet-400" : ""}`}>
              <div className="text-xl">{r.emoji}</div>
              <div className="mt-1 text-sm font-medium text-white">{r.label}</div>
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rank">
          <select value={rank} onChange={(e) => setRank(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {RANKS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
        <Field label="Region">
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {REGIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
        <Field label="Playstyle">
          <select value={playstyle} onChange={(e) => setPlaystyle(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {PLAYSTYLES.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
        <Field label="Language">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
            {LANGUAGES.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Availability">
        <select value={availability} onChange={(e) => setAvailability(e.target.value)} className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white outline-none sqf-focus">
          {AVAILABILITY.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
        </select>
      </Field>
      <Field label="Bio">
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="sqf-glass w-full resize-none rounded-xl px-4 py-3 text-sm text-white outline-none sqf-focus" />
      </Field>
      <div className="mt-6 flex gap-3">
        <button onClick={onClose} className="sqf-press sqf-focus flex-1 rounded-2xl sqf-glass py-3.5 text-sm font-semibold text-white">Cancel</button>
        <button
          onClick={() => onSave({ ign, uid, rank, region, role, playstyle, language, availability, bio })}
          className="sqf-press sqf-focus flex-1 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-3.5 text-sm font-semibold text-white"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

/* Auth gate shown before the app unlocks: Login / Sign Up / Forgot
   Password. No Guest mode. Google sign-in and password reset call real
   AuthProvider methods that honestly report "not connected yet" rather
   than faking success. */
function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next) {
    haptic(6);
    setMode(next);
    setError("");
    setNotice("");
  }

  function validate() {
    if (!email.trim() || !email.includes("@")) return "Enter a valid email address";
    if (mode === "forgot") return "";
    if (password.length < 6) return "Password must be at least 6 characters";
    if (mode === "signup" && password !== confirmPassword) return "Passwords don't match";
    return "";
  }

  async function handleSubmit() {
    const err = validate();
    if (err) { haptic(10); setError(err); return; }
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      if (mode === "forgot") {
        await AuthProvider.requestPasswordReset(email);
      } else if (mode === "signup") {
        const result = await AuthProvider.signUp(email, password);
        haptic(14);
        onAuthenticated(result);
        return;
      } else {
        const result = await AuthProvider.logIn(email, password);
        haptic(14);
        onAuthenticated(result);
        return;
      }
    } catch (e) {
      setNotice((e && e.message) || "That isn't available yet.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    haptic(8);
    setError("");
    setNotice("");
    try {
      const session = await AuthProvider.continueWithGoogle();
      await persistSession(session);
      onAuthenticated(session);
    } catch (e) {
      setNotice((e && e.message) || "Google sign-in isn't connected yet.");
    }
  }

  const title = mode === "login" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password";
  const subtitle =
    mode === "login" ? "Log in to find your squad." :
    mode === "signup" ? "Sign up to start building your squad." :
    "Enter your email and we'll help you back in once this is connected to a real account system.";

  return (
    <RippleRoot>
    <div className="sqf-root relative min-h-dvh w-full">
      <style>{GLOBAL_CSS}</style>
      <BackgroundOrbs />
      <div className="relative flex min-h-dvh w-full items-center justify-center px-5 py-10" style={{ zIndex: 10 }}>
        <div className="sqf-glass-strong sqf-animate-in w-full max-w-md rounded-3xl p-6">
          <div className="mb-6 flex items-center gap-2">
            <div className="sqf-display flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-bold text-white">S</div>
            <span className="text-sm font-medium tracking-wide text-white/60">Squad Finder</span>
          </div>

          <h1 className="sqf-display text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 text-sm text-white/45">{subtitle}</p>

          {mode !== "forgot" && (
            <div className="mt-6 flex gap-1 rounded-full bg-white/5 p-1">
              <button onClick={() => switchMode("login")} className={`sqf-press flex-1 rounded-full py-2 text-sm font-medium transition-colors ${mode === "login" ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white" : "text-white/50"}`}>
                Log In
              </button>
              <button onClick={() => switchMode("signup")} className={`sqf-press flex-1 rounded-full py-2 text-sm font-medium transition-colors ${mode === "signup" ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white" : "text-white/50"}`}>
                Sign Up
              </button>
            </div>
          )}

          {mode !== "forgot" && (
            <>
              <button onClick={handleGoogle} className="sqf-press sqf-focus mt-6 flex w-full items-center justify-center gap-2 rounded-2xl sqf-glass py-3.5 text-sm font-semibold text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.52 12.27c0-.82-.07-1.42-.22-2.05H12v3.91h6.52c-.13 1.06-.85 2.66-2.44 3.73l-.02.15 3.55 2.72.25.02c2.26-2.06 3.56-5.1 3.56-8.48z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.06 7.94-2.87l-3.78-2.9c-1.02.69-2.4 1.17-4.16 1.17-3.18 0-5.88-2.09-6.84-4.98l-.14.01-3.7 2.84-.05.13C3.25 21.3 7.28 24 12 24z" />
                  <path fill="#FBBC05" d="M5.16 14.42a7.2 7.2 0 0 1-.39-2.32c0-.81.14-1.6.38-2.32l-.01-.15-3.75-2.9-.12.06A11.94 11.94 0 0 0 0 12.1c0 1.93.47 3.76 1.27 5.31l3.89-3z" />
                  <path fill="#EA4335" d="M12 4.77c2.25 0 3.77.97 4.64 1.78l3.38-3.3C17.94 1.19 15.24 0 12 0 7.28 0 3.25 2.7 1.27 6.69l3.89 3.01c.96-2.89 3.66-4.93 6.84-4.93z" />
                </svg>
                Continue with Google
              </button>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-white/30">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
            </>
          )}

          <Field label="Email">
            <div className="sqf-glass flex items-center gap-2 rounded-xl px-4 py-3">
              <Mail size={16} className="text-white/40" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none" />
            </div>
          </Field>

          {mode !== "forgot" && (
            <Field label="Password">
              <div className="sqf-glass flex items-center gap-2 rounded-xl px-4 py-3">
                <Lock size={16} className="text-white/40" />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none" />
                <button onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} className="sqf-press text-white/40">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          )}

          {mode === "login" && (
            <button onClick={() => switchMode("forgot")} className="sqf-press mt-2 text-xs text-white/40 underline">
              Forgot Password?
            </button>
          )}

          {mode === "signup" && (
            <Field label="Confirm Password">
              <div className="sqf-glass flex items-center gap-2 rounded-xl px-4 py-3">
                <Lock size={16} className="text-white/40" />
                <input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none" />
                <button onClick={() => setShowConfirmPassword((v) => !v)} aria-label={showConfirmPassword ? "Hide password" : "Show password"} className="sqf-press text-white/40">
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          )}

          {error && <div className="mt-3 text-sm text-rose-300">{error}</div>}
          {notice && <div className="mt-3 rounded-xl bg-white/5 p-3 text-sm text-white/60">{notice}</div>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="sqf-press sqf-focus mt-6 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-violet-500/30 disabled:opacity-60"
          >
            {mode === "login" ? "Log In" : mode === "signup" ? "Create Account" : "Send Reset Link"}
          </button>

          {mode === "forgot" ? (
            <button onClick={() => switchMode("login")} className="sqf-press mt-4 w-full text-center text-xs text-white/40 underline">
              Back to Log In
            </button>
          ) : (
            <p className="mt-5 text-center text-xs text-white/30">Prototype only — no real account is created and nothing is verified.</p>
          )}
        </div>
      </div>
    </div>
    </RippleRoot>
  );
}

/* Shown once, right after a first successful login/signup, until the
   player has a completed gaming profile. IGN/UID/Bio start blank on
   purpose — never auto-filled from a Google account name. */
function ProfileSetupScreen({ me, onComplete }) {
  const [ign, setIgn] = useState("");
  const [uid, setUid] = useState("");
  const [rank, setRank] = useState(me.rank || RANKS[0]);
  const [region, setRegion] = useState(me.region || REGIONS[0]);
  const [role, setRole] = useState(me.role || ROLES[0].id);
  const [playstyle, setPlaystyle] = useState(me.playstyle || PLAYSTYLES[0]);
  const [language, setLanguage] = useState(me.language || LANGUAGES[0]);
  const [availability, setAvailability] = useState(me.availability || AVAILABILITY[0]);
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");

  function handleSave() {
    if (!ign.trim()) { haptic(10); setError("Enter an IGN so other players know who you are."); return; }
    if (!uid.trim()) { haptic(10); setError("Enter your Free Fire UID."); return; }
    haptic(14);
    onComplete({ ign: ign.trim(), uid: uid.trim(), rank, region, role, playstyle, language, availability, bio: bio.trim() });
  }

  return (
    <RippleRoot>
    <div className="sqf-root relative min-h-dvh w-full">
      <style>{GLOBAL_CSS}</style>
      <BackgroundOrbs />
      <div className="relative mx-auto max-w-md pb-10 pt-8 sm:max-w-2xl" style={{ zIndex: 10 }}>
        <div className="px-5">
          <PageHeader title="Set Up Your Profile" subtitle="One-time setup — this is what other players will see." />

          <Field label="IGN / Player Name">
            <input value={ign} onChange={(e) => setIgn(e.target.value)} placeholder="Your in-game name" className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none sqf-focus" />
          </Field>

          <Field label="Free Fire UID">
            <input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="e.g. 1234 5678 900" className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none sqf-focus" />
          </Field>

          <Field label="Preferred Role">
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button key={r.id} onClick={() => { haptic(6); setRole(r.id); }} className={`sqf-press rounded-2xl sqf-glass p-3 text-left ${role === r.id ? "ring-2 ring-violet-400" : ""}`}>
                  <div className="text-xl">{r.emoji}</div>
                  <div className="mt-1 text-sm font-medium text-white">{r.label}</div>
                  <div className="text-xs text-white/40">{r.sub}</div>
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rank">
              <select value={rank} onChange={(e) => setRank(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
                {RANKS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
              </select>
            </Field>
            <Field label="Region">
              <select value={region} onChange={(e) => setRegion(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
                {REGIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
              </select>
            </Field>
            <Field label="Playstyle">
              <select value={playstyle} onChange={(e) => setPlaystyle(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
                {PLAYSTYLES.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
              </select>
            </Field>
            <Field label="Language">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="sqf-glass w-full rounded-xl px-3 py-3 text-sm text-white outline-none sqf-focus">
                {LANGUAGES.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Availability">
            <select value={availability} onChange={(e) => setAvailability(e.target.value)} className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white outline-none sqf-focus">
              {AVAILABILITY.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
            </select>
          </Field>

          <Field label="Short Bio">
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Tell squads a bit about how you play" className="sqf-glass w-full resize-none rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none sqf-focus" />
          </Field>

          {error && <div className="mt-3 text-sm text-rose-300">{error}</div>}

          <button onClick={handleSave} className="sqf-press sqf-focus mt-6 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-4 text-center text-base font-semibold text-white shadow-lg shadow-violet-500/30">
            Save & Continue
          </button>
        </div>
      </div>
    </div>
    </RippleRoot>
  );
}
/* Update prompt. When manifest.forceUpdate is true, there is no "Later"
   button and the backdrop does not dismiss it. */
function UpdateDialog({ manifest, installStatus, downloadProgress, installError, onUpdateNow, onLater, onRetry }) {
  const forceUpdate = !!(manifest && manifest.forceUpdate);
  const downloading = installStatus === "downloading";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={forceUpdate ? undefined : onLater}
    >
      <div onClick={(e) => e.stopPropagation()} className="sqf-glass-strong sqf-modal-in w-full max-w-md rounded-3xl p-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400">
          <Download size={22} className="text-white" />
        </div>
        <h3 className="sqf-display mt-4 text-center text-xl font-bold text-white">New Update Available</h3>
        <p className="mt-1 text-center text-sm text-white/50">Version {manifest.latestVersion}</p>

        {Array.isArray(manifest.changelog) && manifest.changelog.length > 0 && (
          <ul className="mt-4 space-y-2">
            {manifest.changelog.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                {line}
              </li>
            ))}
          </ul>
        )}

        {forceUpdate && (
          <div className="mt-4 rounded-xl bg-rose-500/10 p-3 text-center text-xs text-rose-300">
            This update is required to keep using Squad Finder.
          </div>
        )}

        {downloading && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all" style={{ width: downloadProgress + "%" }} />
            </div>
            <div className="mt-1.5 text-center text-xs text-white/40">Downloading — {downloadProgress}%</div>
          </div>
        )}

        {installStatus === "downloaded" && (
          <div className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-center text-xs text-emerald-300">
            Download complete — handing off to Android to finish installing.
          </div>
        )}

        {installStatus === "error" && installError && (
          <div className="mt-4 rounded-xl bg-rose-500/10 p-3 text-center text-xs text-rose-300">{installError}</div>
        )}

        <div className="mt-6 flex gap-3">
          {!forceUpdate && !downloading && (
            <button onClick={onLater} className="sqf-press sqf-focus flex-1 rounded-2xl sqf-glass py-3.5 text-sm font-semibold text-white">
              Later
            </button>
          )}
          {installStatus === "error" ? (
            <button onClick={onRetry} className="sqf-press sqf-focus flex-1 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-3.5 text-sm font-semibold text-white">
              Retry
            </button>
          ) : (
            <button
              onClick={onUpdateNow}
              disabled={downloading || installStatus === "downloaded"}
              className="sqf-press sqf-focus flex-1 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {downloading ? "Downloading…" : "Update Now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   PAGES
=================================================================== */

function StatTile({ label, value, live }) {
  return (
    <div className="sqf-glass rounded-2xl p-4">
      <div className="flex items-center gap-1.5">
        {live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 sqf-status-dot-live" />}
        <span className="sqf-display text-2xl font-semibold text-white">{value.toLocaleString()}</span>
      </div>
      <div className="mt-1 text-xs text-white/50">{label}</div>
    </div>
  );
}

function HomePage({ stats, onFind, onCreate, onQuickMatch }) {
  const online = useCountUp(stats.online);
  const created = useCountUp(stats.squadsCreated);
  const complete = useCountUp(stats.squadsComplete);
  const looking = useCountUp(stats.lookingForTeam);
  return (
    <div className="px-5 pt-8">
      <div className="mb-10 flex items-center gap-2">
        <div className="sqf-display flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-bold text-white">S</div>
        <span className="text-sm font-medium tracking-wide text-white/60">Squad Finder</span>
      </div>

      <h1 className="sqf-display text-4xl font-bold leading-none tracking-tight text-white sm:text-6xl">
        BUILD YOUR<br />PERFECT SQUAD.
      </h1>
      <p className="mt-5 max-w-sm text-base leading-relaxed text-white/60">
        Find the right players. Complete your 4-man team. Dominate together.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button onClick={() => { haptic(10); onFind(); }} className="sqf-press sqf-focus rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 px-6 py-4 text-center text-base font-semibold text-white shadow-lg shadow-violet-500/30">
          Find Players
        </button>
        <button onClick={() => { haptic(10); onCreate(); }} className="sqf-press sqf-focus sqf-glass rounded-2xl px-6 py-4 text-center text-base font-semibold text-white">
          Create Squad
        </button>
      </div>

      <button onClick={() => { haptic(10); onQuickMatch(); }} className="sqf-press sqf-focus sqf-glass-strong mt-3 flex w-full items-center gap-3 rounded-2xl p-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-lg">🎯</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">Find My Squad</div>
          <div className="text-xs text-white/45">Get matched to squads that need your role</div>
        </div>
        <ChevronRight size={18} className="text-white/30" />
      </button>

      <div className="mt-12 grid grid-cols-2 gap-3">
        <StatTile label="Players Online" value={online} live />
        <StatTile label="Squads Created" value={created} />
        <StatTile label="Squads Complete" value={complete} />
        <StatTile label="Looking for Team" value={looking} />
      </div>
    </div>
  );
}

function PlayerCard({ player, onView, onInvite, inviteState }) {
  const role = roleById[player.role];
  const labelFor = { invite: "Invite", "role-filled": "Role Filled", full: "Squad Full", "no-squad": "No Squad" };
  return (
    <div className="sqf-glass rounded-2xl p-4">
      <button onClick={onView} className="sqf-press flex w-full items-center gap-3 text-left">
        <Avatar player={player} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate font-semibold text-white">{player.ign}</div>
            <LfgDot status={player.lfgStatus} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge>{role.emoji} {role.label}</Badge>
            <Badge className={RANK_COLORS[player.rank]}>{player.rank}</Badge>
          </div>
        </div>
      </button>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge>{player.region}</Badge>
        <Badge>{player.playstyle}</Badge>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onView} className="sqf-press sqf-focus flex-1 rounded-xl sqf-glass py-2 text-sm font-medium text-white/80">
          View Profile
        </button>
        <button
          onClick={inviteState === "invite" ? onInvite : undefined}
          disabled={inviteState !== "invite"}
          className={`sqf-press sqf-focus flex-1 rounded-xl py-2 text-sm font-medium ${inviteState === "invite" ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white" : "bg-white/5 text-white/30"}`}
        >
          {labelFor[inviteState]}
        </button>
      </div>
    </div>
  );
}

function FindPlayersPage({ players, me, mySquad, onView, onInvite, filters, setFilters, search, setSearch, showSheet, setShowSheet, loading }) {
  const filtered = useMemo(() => {
    return players.filter((p) => {
      if (p.id === me.id) return false;
      if (search && !p.ign.toLowerCase().includes(search.toLowerCase())) return false;
      if (filters.role && p.role !== filters.role) return false;
      if (filters.rank && p.rank !== filters.rank) return false;
      if (filters.region && p.region !== filters.region) return false;
      if (filters.language && p.language !== filters.language) return false;
      if (filters.playstyle && p.playstyle !== filters.playstyle) return false;
      if (filters.availability && p.availability !== filters.availability) return false;
      if (filters.lfgStatus && p.lfgStatus !== filters.lfgStatus) return false;
      return true;
    });
  }, [players, me.id, search, filters]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="px-5 pt-8">
      <PageHeader title="Find Players" subtitle={`${filtered.length} players match your search`} />

      <div className="mt-5 flex gap-2">
        <div className="sqf-glass flex flex-1 items-center gap-2 rounded-xl px-4 py-3">
          <Search size={18} className="text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by IGN"
            className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none"
          />
        </div>
        <button onClick={() => setShowSheet(true)} aria-label="Open filters" className="sqf-press sqf-glass sqf-focus relative rounded-xl px-4 py-3">
          <Filter size={18} />
          {activeFilterCount > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-violet-500 ring-2 ring-black" />}
        </button>
      </div>

      {loading ? (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => <PlayerCardSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No players found" subtitle="Try adjusting your filters or search term." />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2">
          {filtered.map((p) => (
            <PlayerCard key={p.id} player={p} onView={() => onView(p.id)} onInvite={() => onInvite(p)} inviteState={inviteStateFor(p, mySquad)} />
          ))}
        </div>
      )}

      <FilterSheet
        open={showSheet}
        onClose={() => setShowSheet(false)}
        filters={filters}
        setFilters={setFilters}
        groups={[
          { key: "role", label: "Role", options: ROLES.map((r) => ({ value: r.id, label: `${r.emoji} ${r.label}` })) },
          { key: "lfgStatus", label: "Status", options: LFG_STATUSES.map((s) => ({ value: s.id, label: `${s.emoji} ${s.label}` })) },
          { key: "rank", label: "Rank", options: RANKS.map((r) => ({ value: r, label: r })) },
          { key: "region", label: "Region", options: REGIONS.map((r) => ({ value: r, label: r })) },
          { key: "language", label: "Language", options: LANGUAGES.map((r) => ({ value: r, label: r })) },
          { key: "playstyle", label: "Playstyle", options: PLAYSTYLES.map((r) => ({ value: r, label: r })) },
          { key: "availability", label: "Availability", options: AVAILABILITY.map((r) => ({ value: r, label: r })) },
        ]}
      />
    </div>
  );
}

function CreateSquadPage({ me, onCreate }) {
  const [name, setName] = useState("");
  const [logoEmoji, setLogoEmoji] = useState(EMBLEMS[0]);
  const [region, setRegion] = useState(me.region);
  const [description, setDescription] = useState("");
  const [yourRole, setYourRole] = useState(me.role);
  const canSubmit = name.trim().length >= 3;

  return (
    <div className="px-5 pb-6 pt-8">
      <PageHeader title="Create Squad" subtitle="Set up your squad and pick your role." />

      <Field label="Squad Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Obsidian Vanguard" className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none sqf-focus" />
      </Field>

      <Field label="Squad Logo">
        <div className="flex gap-2 overflow-x-auto pb-1 sqf-scroll">
          {EMBLEMS.map((e) => (
            <button key={e} onClick={() => { haptic(6); setLogoEmoji(e); }} className={`sqf-press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sqf-glass text-xl ${logoEmoji === e ? "ring-2 ring-violet-400" : ""}`}>
              {e}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Region">
        <select value={region} onChange={(e) => setRegion(e.target.value)} className="sqf-glass w-full rounded-xl px-4 py-3 text-sm text-white outline-none sqf-focus">
          {REGIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
        </select>
      </Field>

      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's your squad about?" className="sqf-glass w-full resize-none rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none sqf-focus" />
      </Field>

      <Field label="Your Role">
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button key={r.id} onClick={() => { haptic(6); setYourRole(r.id); }} className={`sqf-press rounded-2xl sqf-glass p-3 text-left ${yourRole === r.id ? "ring-2 ring-violet-400" : ""}`}>
              <div className="text-xl">{r.emoji}</div>
              <div className="mt-1 text-sm font-medium text-white">{r.label}</div>
              <div className="text-xs text-white/40">{r.sub}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="mt-4 rounded-2xl bg-white/5 p-3 text-xs text-white/45">
        The other 3 slots start open — invite players from Find Players or your squad page once it's created.
      </div>

      <button
        disabled={!canSubmit}
        onClick={() => canSubmit && onCreate({ name: name.trim(), logoEmoji, region, description: description.trim(), yourRole })}
        className={`sqf-press sqf-focus mt-6 w-full rounded-2xl py-4 text-center text-base font-semibold ${canSubmit ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-500/30" : "bg-white/5 text-white/30"}`}
      >
        Create Squad
      </button>
    </div>
  );
}

function SquadCard({ squad, players, onOpen, compatibility, recruiting }) {
  const complete = isSquadComplete(squad);
  const missing = missingRoles(squad);
  return (
    <button onClick={onOpen} className="sqf-press sqf-focus block w-full rounded-2xl sqf-glass p-4 text-left">
      <div className="flex items-center gap-3">
        <SquadLogo squad={squad} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate font-semibold text-white">{squad.name}</div>
            {recruiting && <span title="Actively recruiting">📢</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{squad.region}</Badge>
            <Badge className={RANK_COLORS[squad.rankTier]}>{squad.rankTier}</Badge>
          </div>
        </div>
        {compatibility && <CompatibilityBadge pct={compatibility.pct} size="sm" />}
      </div>

      <p className="mt-3 text-sm text-white/50">{truncate(squad.description, 90)}</p>

      <div className="mt-3 flex items-center gap-2">
        {ROLES.map((r) => {
          const pid = squad.slots[r.id];
          const p = pid ? players.find((pl) => pl.id === pid) : null;
          return (
            <div key={r.id} className="flex flex-1 flex-col items-center gap-1">
              {p ? <Avatar player={p} size={36} /> : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-white/15 text-sm">{r.emoji}</div>
              )}
              <span className="text-xs text-white/35">{r.label}</span>
            </div>
          );
        })}
      </div>

      {compatibility && compatibility.reasons && compatibility.reasons.length > 0 && (
        <div className="mt-3"><CompatibilityReasons reasons={compatibility.reasons} /></div>
      )}

      <div className="mt-3">
        <StatusPill complete={complete} />
        {!complete && <div className="mt-1.5 text-xs text-white/45">Missing: {missing.map((r) => roleById[r].label).join(", ")}</div>}
      </div>
    </button>
  );
}

function SquadDirectoryPage({ squads, players, recruitmentPosts, filters, setFilters, showSheet, setShowSheet, loading, onOpen }) {
  const filtered = useMemo(() => {
    return squads.filter((s) => {
      const complete = isSquadComplete(s);
      if (filters.status === "complete" && !complete) return false;
      if (filters.status === "looking" && complete) return false;
      if (filters.roleNeeded && !missingRoles(s).includes(filters.roleNeeded)) return false;
      if (filters.rank && s.rankTier !== filters.rank) return false;
      if (filters.region && s.region !== filters.region) return false;
      return true;
    });
  }, [squads, filters]);

  return (
    <div className="px-5 pt-8">
      <PageHeader title="Squads" subtitle={`${filtered.length} squads`} />
      <div className="mt-5 flex items-center gap-2">
        <div className="flex flex-1 gap-2 overflow-x-auto sqf-scroll">
          <QuickChip active={filters.status === "complete"} onClick={() => setFilters((f) => ({ ...f, status: f.status === "complete" ? "" : "complete" }))}>Complete</QuickChip>
          <QuickChip active={filters.status === "looking"} onClick={() => setFilters((f) => ({ ...f, status: f.status === "looking" ? "" : "looking" }))}>Looking for Players</QuickChip>
        </div>
        <button onClick={() => setShowSheet(true)} aria-label="Open filters" className="sqf-press sqf-glass sqf-focus shrink-0 rounded-xl px-4 py-2.5">
          <Filter size={16} />
        </button>
      </div>

      {loading ? (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <SquadCardSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No squads found" subtitle="Try different filters." />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2">
          {filtered.map((s) => (
            <SquadCard
              key={s.id} squad={s} players={players} onOpen={() => onOpen(s.id)}
              recruiting={recruitmentPosts.some((p) => p.squadId === s.id && p.status === "open")}
            />
          ))}
        </div>
      )}

      <FilterSheet
        open={showSheet}
        onClose={() => setShowSheet(false)}
        filters={filters}
        setFilters={setFilters}
        groups={[
          { key: "roleNeeded", label: "Role Needed", options: ROLES.map((r) => ({ value: r.id, label: `${r.emoji} ${r.label}` })) },
          { key: "rank", label: "Rank", options: RANKS.map((r) => ({ value: r, label: r })) },
          { key: "region", label: "Region", options: REGIONS.map((r) => ({ value: r, label: r })) },
        ]}
      />
    </div>
  );
}

/* "Find My Squad": recommends squads that need the player's own role,
   ranked by the same compatibility scoring used everywhere else.
   Reuses SquadCard for display; opening a result goes through the
   existing Squad Detail page, where Request to Join already works. */
function QuickMatchPage({ me, squads, players, onBack, onOpenSquad }) {
  const recommendations = useMemo(() => {
    return squads
      .filter((s) => missingRoles(s).includes(me.role))
      .map((s) => ({ squad: s, ...compatibilityForSquad(me, s, players) }))
      .sort((a, b) => b.pct - a.pct);
  }, [squads, players, me]);

  return (
    <div className="px-5 pb-4 pt-6">
      <button onClick={onBack} className="sqf-press mb-4 flex items-center gap-1.5 text-sm text-white/60">
        <ArrowLeft size={16} /> Back
      </button>
      <PageHeader title="Find My Squad" subtitle={`${recommendations.length} squads need a ${roleById[me.role].label}`} />

      {recommendations.length === 0 ? (
        <EmptyState icon={Users} title="No matches right now" subtitle="Check back once more squads are recruiting your role." />
      ) : (
        <div className="mt-5 space-y-3">
          {recommendations.map(({ squad, pct, reasons }) => (
            <SquadCard key={squad.id} squad={squad} players={players} onOpen={() => onOpenSquad(squad.id)} compatibility={{ pct, reasons }} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotCard({ role, player, editable, onTapEmpty, onTapFilled, onRemove }) {
  if (player) {
    return (
      <div className="sqf-glass relative rounded-2xl p-3">
        {editable && (
          <button onClick={onRemove} aria-label={`Remove ${player.ign}`} className="sqf-press absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/50">
            <X size={12} />
          </button>
        )}
        <button onClick={onTapFilled} className="sqf-press flex w-full flex-col items-center gap-2 text-center">
          <Avatar player={player} size={44} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{player.ign}</div>
            <div className="text-xs text-white/40">{role.emoji} {role.label}</div>
          </div>
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={editable ? onTapEmpty : undefined}
      disabled={!editable}
      className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 p-3 text-center ${editable ? "sqf-press text-white/50" : "text-white/25"}`}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-lg">{role.emoji}</div>
      <div className="text-xs font-medium">{editable ? `Add ${role.label}` : `${role.label} needed`}</div>
    </button>
  );
}

function SquadDetailPage({ squad, players, me, isMine, isLeaderView, requests, recruitmentPost, onBack, onSlotTap, onRemoveSlot, onRequestJoin, onLeave, onAcceptRequest, onRejectRequest, onViewPlayer, onOpenChat, hasUnread, onOpenAutoFill, onManagePost, onClosePost, onReopenPost }) {
  const complete = isSquadComplete(squad);
  const missing = missingRoles(squad);
  const myOpenRoleSlot = !squad.slots[me.role] ? me.role : null;
  const pendingForThisSquad = requests.filter((r) => r.squadId === squad.id && r.status === "pending");
  const alreadyRequested = requests.some((r) => r.squadId === squad.id && r.playerId === me.id && r.status === "pending");
  const pastMembers = (squad.memberHistory || []).filter((m) => m.leftAt);

  return (
    <div className="px-5 pb-6 pt-6">
      <button onClick={onBack} className="sqf-press mb-4 flex items-center gap-1.5 text-sm text-white/60">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="sqf-glass-strong rounded-3xl p-6 text-center">
        <div className="mx-auto"><SquadLogo squad={squad} size={72} /></div>
        <h2 className="sqf-display mt-4 text-2xl font-bold text-white">{squad.name}</h2>
        <div className="mt-2 flex justify-center"><StatusPill complete={complete} /></div>
        {!complete && <div className="mt-1.5 text-xs text-white/45">Missing: {missing.map((r) => roleById[r].label).join(", ")}</div>}
        <div className="mt-3 flex justify-center gap-1.5">
          <Badge>{squad.region}</Badge>
          <Badge className={RANK_COLORS[squad.rankTier]}>{squad.rankTier}</Badge>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-white/55">{squad.description}</p>
      </div>

      {isMine && (
        <button
          onClick={onOpenChat}
          className="sqf-press sqf-focus relative mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30"
        >
          <MessageCircle size={16} /> Squad Chat
          {hasUnread && <span className="absolute right-5 h-2.5 w-2.5 rounded-full bg-rose-400 ring-2 ring-black" />}
        </button>
      )}

      {isLeaderView && !complete && (
        <button onClick={onOpenAutoFill} className="sqf-press sqf-focus mt-3 flex w-full items-center justify-center gap-2 rounded-2xl sqf-glass py-3.5 text-sm font-semibold text-white">
          ✨ Auto-Fill Missing Roles
        </button>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        {ROLES.map((r) => {
          const pid = squad.slots[r.id];
          const p = pid ? players.find((pl) => pl.id === pid) : null;
          return (
            <SlotCard
              key={r.id}
              role={r}
              player={p}
              editable={isLeaderView}
              onTapEmpty={() => onSlotTap(r.id)}
              onTapFilled={() => onViewPlayer(p.id)}
              onRemove={() => onRemoveSlot(r.id)}
            />
          );
        })}
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-white/70">Recruitment Post</h3>
        {recruitmentPost ? (
          <div className="sqf-glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-white">📢 Recruiting</div>
              <Badge className={recruitmentPost.status === "open" ? "text-emerald-300" : "text-white/40"}>
                {recruitmentPost.status === "open" ? "Open" : "Closed"}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recruitmentPost.roles.map((r) => <Badge key={r}>{roleById[r].emoji} {roleById[r].label}</Badge>)}
              <Badge className={RANK_COLORS[recruitmentPost.minRank]}>{recruitmentPost.minRank}+</Badge>
              <Badge>{recruitmentPost.language}</Badge>
              <Badge>{recruitmentPost.availability}</Badge>
            </div>
            {recruitmentPost.description && <p className="mt-2 text-sm text-white/60">{recruitmentPost.description}</p>}
            {isLeaderView && (
              <div className="mt-3 flex gap-2">
                <button onClick={onManagePost} className="sqf-press sqf-focus flex-1 rounded-xl sqf-glass py-2 text-sm font-medium text-white/80">Edit</button>
                {recruitmentPost.status === "open" ? (
                  <button onClick={onClosePost} className="sqf-press sqf-focus flex-1 rounded-xl bg-rose-500/10 py-2 text-sm font-medium text-rose-300">Close</button>
                ) : (
                  <button onClick={onReopenPost} className="sqf-press sqf-focus flex-1 rounded-xl bg-emerald-500/10 py-2 text-sm font-medium text-emerald-300">Reopen</button>
                )}
              </div>
            )}
          </div>
        ) : isLeaderView ? (
          <button onClick={onManagePost} className="sqf-press sqf-focus w-full rounded-2xl sqf-glass py-3 text-sm font-medium text-white/70">
            + Create Recruitment Post
          </button>
        ) : (
          <div className="rounded-2xl bg-white/5 p-3 text-center text-xs text-white/40">This squad isn't posting a recruitment listing.</div>
        )}
      </div>

      {isLeaderView && pendingForThisSquad.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-white/70">Join Requests</h3>
          <div className="space-y-2">
            {pendingForThisSquad.map((req) => {
              const p = players.find((pl) => pl.id === req.playerId);
              return (
                <div key={req.id} className="sqf-glass flex items-center gap-3 rounded-2xl p-3">
                  <Avatar player={p} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{p.ign}</div>
                    <div className="text-xs text-white/45">Wants {roleById[req.role].label}</div>
                  </div>
                  <button onClick={() => onAcceptRequest(req.id)} aria-label="Accept request" className="sqf-press sqf-focus flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                    <Check size={16} />
                  </button>
                  <button onClick={() => onRejectRequest(req.id)} aria-label="Reject request" className="sqf-press sqf-focus flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/20 text-rose-300">
                    <X size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-white/70">Squad History</h3>
        <div className="sqf-glass rounded-2xl p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Created</span>
            <span className="text-white">{formatDate(squad.createdAt)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-white/50">Status</span>
            <span className="text-white">{complete ? "Complete" : "Recruiting"}</span>
          </div>
          {pastMembers.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
              <div className="mb-1 text-xs text-white/40">Previous members</div>
              {pastMembers.map((entry, i) => {
                const p = players.find((pl) => pl.id === entry.playerId);
                if (!p) return null;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Avatar player={p} size={28} />
                    <div className="min-w-0 flex-1 text-xs text-white/60">{p.ign} · {roleById[entry.role].label}</div>
                    <div className="shrink-0 text-xs text-white/30">Left {formatDate(entry.leftAt)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        {isLeaderView ? (
          <button onClick={onLeave} className="sqf-press sqf-focus w-full rounded-2xl sqf-glass py-4 text-center text-sm font-semibold text-rose-300">
            Leave Squad
          </button>
        ) : isMine ? (
          <button onClick={onLeave} className="sqf-press sqf-focus w-full rounded-2xl sqf-glass py-4 text-center text-sm font-semibold text-rose-300">
            Leave Squad
          </button>
        ) : complete ? (
          <div className="rounded-2xl bg-white/5 p-3 text-center text-xs text-white/40">This squad is full</div>
        ) : myOpenRoleSlot ? (
          alreadyRequested ? (
            <div className="w-full rounded-2xl bg-white/5 py-4 text-center text-sm font-medium text-white/40">Request Pending</div>
          ) : (
            <button onClick={onRequestJoin} className="sqf-press sqf-focus w-full rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-500 py-4 text-center text-sm font-semibold text-white shadow-lg shadow-violet-500/30">
              Request to Join as {roleById[me.role].label}
            </button>
          )
        ) : (
          <div className="rounded-2xl bg-white/5 p-3 text-center text-xs text-white/40">Not recruiting your role right now</div>
        )}
      </div>
    </div>
  );
}

/* Full-screen, members-only chat for one squad. Access is re-checked by
   the caller (App) on every render, so leaving a squad hides this
   screen automatically — nothing here trusts a stale prop. */
function SquadChatScreen({ squad, players, me, messages, isLeaderView, onSend, onToggleReady, onSendMatchStarting, onClose }) {
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState("");
  const [composeMode, setComposeMode] = useState("text");
  const scrollRef = useRef(null);

  const thread = messages.filter((m) => m.squadId === squad.id).sort((a, b) => a.ts - b.ts);
  const readyState = squad.readyState || {};
  const iAmReady = !!readyState[me.id];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.length]);

  function handleClose() {
    haptic(6);
    setClosing(true);
    setTimeout(onClose, 260);
  }

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    onSend(text, composeMode);
    setDraft("");
    setComposeMode("text");
    haptic(8);
  }

  function handleMatchStarting() {
    haptic(12);
    onSendMatchStarting();
  }

  return (
    <RippleRoot>
      <div className={`fixed inset-0 z-50 ${closing ? "sqf-chat-out" : "sqf-chat-in"}`}>
        <div className="sqf-root relative flex h-full w-full flex-col">
          <style>{GLOBAL_CSS}</style>
          <BackgroundOrbs />
          <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col sm:max-w-2xl" style={{ zIndex: 10 }}>
            <div className="sqf-glass-strong flex items-center gap-3 px-5 pb-4 pt-6">
              <button onClick={handleClose} aria-label="Close chat" className="sqf-press sqf-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full sqf-glass text-white/70">
                <ArrowLeft size={16} />
              </button>
              <SquadLogo squad={squad} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{squad.name}</div>
                <div className="text-xs text-white/40">Squad Chat</div>
              </div>
            </div>

            <div className="px-5 py-3">
              <div className="flex gap-2 overflow-x-auto sqf-scroll">
                {ROLES.map((r) => {
                  const pid = squad.slots[r.id];
                  const p = pid ? players.find((pl) => pl.id === pid) : null;
                  return (
                    <div key={r.id} className="sqf-glass flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3">
                      {p ? <Avatar player={p} size={24} /> : <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-xs">{r.emoji}</div>}
                      <span className="text-xs text-white/70">{p ? p.ign : "Open"}</span>
                      {p && readyState[p.id] && <span title="Ready" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                      {p && p.id === squad.leaderId && <span title="Squad Leader">👑</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-3 sqf-scroll">
              {thread.length === 0 ? (
                <EmptyState icon={MessageCircle} title="No messages yet" subtitle="Say hello to your squad." small />
              ) : (
                thread.map((m) => {
                  if (m.type === "system") {
                    return (
                      <div key={m.id} className="sqf-msg-in flex justify-center">
                        <div className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/40">{m.text}</div>
                      </div>
                    );
                  }
                  if (m.type === "matchStarting") {
                    return (
                      <div key={m.id} className="sqf-msg-in rounded-2xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 p-3 text-center text-sm font-semibold text-emerald-300">
                        🚀 {m.text}
                      </div>
                    );
                  }
                  const sender = players.find((p) => p.id === m.senderId);
                  if (m.type === "announcement") {
                    return (
                      <div key={m.id} className="sqf-msg-in rounded-2xl border border-violet-400/30 bg-violet-500/10 p-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300">📢 Announcement · {sender ? sender.ign : "Leader"}</div>
                        <div className="mt-1 text-sm text-white/85">{m.text}</div>
                      </div>
                    );
                  }
                  const mine = m.senderId === me.id;
                  return (
                    <div key={m.id} className={`sqf-msg-in flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-xs rounded-2xl px-4 py-2.5 ${mine ? "bg-gradient-to-br from-violet-500 to-indigo-500 text-white" : "sqf-glass text-white/85"}`}>
                        {!mine && <div className="mb-0.5 text-xs font-medium text-violet-300">{sender ? sender.ign : "Unknown"}</div>}
                        <div className="text-sm leading-relaxed">{m.text}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex gap-2 overflow-x-auto px-5 pb-2 sqf-scroll">
              <QuickChip active={iAmReady} onClick={onToggleReady}>{iAmReady ? "✅ Ready" : "Mark Ready"}</QuickChip>
              {isLeaderView && (
                <>
                  <QuickChip active={composeMode === "announcement"} onClick={() => setComposeMode((m) => (m === "announcement" ? "text" : "announcement"))}>
                    📢 Announce
                  </QuickChip>
                  <QuickChip active={false} onClick={handleMatchStarting}>🚀 Match Starting</QuickChip>
                </>
              )}
            </div>

            <div className="sqf-glass-strong sqf-safe-bottom flex items-center gap-2 px-4 pb-6 pt-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                placeholder={composeMode === "announcement" ? "Write an announcement…" : "Message your squad"}
                className="sqf-glass min-w-0 flex-1 rounded-full px-4 py-3 text-sm text-white placeholder-white/30 outline-none"
              />
              <button onClick={handleSend} aria-label="Send message" className="sqf-press sqf-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 text-white">
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </RippleRoot>
  );
}

function LeaderboardPage({ players, squads, tab, setTab, onViewPlayer, onOpenSquad }) {
  const tabs = [
    { id: "squads", label: "Squads" },
    { id: "players", label: "Players" },
    { id: "wins", label: "Wins" },
    { id: "kills", label: "Kills" },
    { id: "mvps", label: "MVPs" },
  ];

  const rows = useMemo(() => {
    if (tab === "squads") {
      return [...squads].sort((a, b) => (b.wins || 0) - (a.wins || 0)).map((s) => ({ id: s.id, name: s.name, sub: s.region, subColor: "", value: s.wins || 0, isSquad: true, entity: s }));
    }
    const key = tab === "kills" ? "kills" : tab === "mvps" ? "mvps" : "wins";
    return [...players].sort((a, b) => b[key] - a[key]).map((p) => ({ id: p.id, name: p.ign, sub: p.rank, subColor: RANK_COLORS[p.rank], value: p[key], isSquad: false, entity: p }));
  }, [tab, players, squads]);

  return (
    <div className="px-5 pb-4 pt-8">
      <PageHeader title="Leaderboard" subtitle="Top performers this season" />
      <div className="mt-5 flex gap-2 overflow-x-auto sqf-scroll">
        {tabs.map((t) => <QuickChip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</QuickChip>)}
      </div>

      <div className="mt-5 space-y-2">
        {rows.map((row, i) => (
          <button
            key={row.id}
            onClick={() => (row.isSquad ? onOpenSquad(row.id) : onViewPlayer(row.id))}
            className="sqf-press sqf-focus flex w-full items-center gap-3 rounded-2xl sqf-glass p-3 text-left"
          >
            <div className={`sqf-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${i === 0 ? "bg-amber-400/20 text-amber-300" : i === 1 ? "bg-slate-300/20 text-slate-200" : i === 2 ? "bg-orange-400/20 text-orange-300" : "text-white/40"}`}>
              {i + 1}
            </div>
            {row.isSquad ? <SquadLogo squad={row.entity} size={40} /> : <Avatar player={row.entity} size={40} />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{row.name}</div>
              <div className={`text-xs ${row.subColor || "text-white/40"}`}>{row.sub}</div>
            </div>
            <div className="sqf-display text-right text-lg font-bold text-white">{row.value.toLocaleString()}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfilePage({ me, mySquad, onEdit, onOpenSquad, session, onLogout, checkStatus, checkError, hasUpdateAvailable, onCheckForUpdate, onPreviewUpdate, onSetLfgStatus }) {
  const role = roleById[me.role];
  return (
    <div className="px-5 pb-4 pt-8">
      <PageHeader title="Profile" />
      <div className="sqf-glass-strong mt-2 rounded-3xl p-6 text-center">
        <div className="mx-auto"><Avatar player={me} size={84} /></div>
        <h2 className="sqf-display mt-4 text-2xl font-bold text-white">{me.ign}</h2>
        <div className="mt-1 text-sm text-white/45">UID {me.uid}</div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <Badge>{role.emoji} {role.label}</Badge>
          <Badge className={RANK_COLORS[me.rank]}>{me.rank}</Badge>
          <Badge>{me.region}</Badge>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-white/60">{me.bio}</p>
        <button onClick={onEdit} className="sqf-press sqf-focus mt-5 inline-flex items-center gap-1.5 rounded-xl sqf-glass px-4 py-2.5 text-sm font-medium text-white">
          <Edit3 size={14} /> Edit Profile
        </button>
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold text-white/70">Status</h3>
        <div className="grid grid-cols-2 gap-2">
          {LFG_STATUSES.map((s) => (
            <button
              key={s.id}
              onClick={() => onSetLfgStatus(s.id)}
              className={`sqf-press rounded-2xl sqf-glass p-3 text-left ${me.lfgStatus === s.id ? "ring-2 ring-violet-400" : ""}`}
            >
              <span className="text-lg">{s.emoji}</span>
              <div className="mt-1 text-sm font-medium text-white">{s.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <InfoTile label="Playstyle" value={me.playstyle} />
        <InfoTile label="Language" value={me.language} />
        <InfoTile label="Availability" value={me.availability} />
        <InfoTile label="Region" value={me.region} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-white/70">My Squad</h3>
        {mySquad ? (
          <button onClick={onOpenSquad} className="sqf-press sqf-focus flex w-full items-center gap-3 rounded-2xl sqf-glass p-4 text-left">
            <SquadLogo squad={mySquad} size={44} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{mySquad.name}</div>
              <div className="text-xs text-white/40">{Object.values(mySquad.slots).filter(Boolean).length}/4 filled</div>
            </div>
            <ChevronRight size={18} className="text-white/30" />
          </button>
        ) : (
          <EmptyState icon={Users} title="No squad yet" subtitle="Create one or find players to join a team." small />
        )}
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-white/70">Account</h3>
        <div className="sqf-glass rounded-2xl p-4">
          <div className="text-sm font-medium text-white">
            {session ? session.email : ""}
          </div>
          <div className="mt-0.5 text-xs text-white/40">
            Signed in
          </div>
          <button onClick={onLogout} className="sqf-press sqf-focus mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-rose-500/10 py-2.5 text-sm font-semibold text-rose-300">
            <LogOut size={14} /> Log Out
          </button>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-white/70">About</h3>
        <div className="sqf-glass rounded-2xl p-4 text-center">
          <div className="sqf-display text-base font-semibold text-white">Squad Finder</div>
          <div className="mt-0.5 text-xs text-white/40">Version {CURRENT_APP_VERSION}</div>

          <button
            onClick={onCheckForUpdate}
            disabled={checkStatus === "checking"}
            className="sqf-press sqf-focus mt-3 w-full rounded-xl sqf-glass py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {checkStatus === "checking" ? "Checking…" : "Check for Updates"}
          </button>

          <div className="mt-2 min-h-4 text-xs text-white/40">
            {checkStatus === "unconfigured" && "Update checking isn't configured yet."}
            {checkStatus === "done" && !hasUpdateAvailable && "You're up to date."}
            {checkStatus === "done" && hasUpdateAvailable && "Update available."}
            {checkStatus === "error" && (
              <span className="text-rose-300">
                {checkError || "Update check failed."}{" "}
                <button onClick={onCheckForUpdate} className="underline">Retry</button>
              </span>
            )}
          </div>

          <button onClick={onPreviewUpdate} className="sqf-press mt-3 text-xs text-white/25 underline">
            Preview update dialog (sample data)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   APP SHELL
=================================================================== */

function BackgroundOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
      <div className="sqf-orb" style={{ width: 340, height: 340, top: -100, left: -80, background: "radial-gradient(circle, rgba(139,92,246,0.30), transparent 70%)" }} />
      <div className="sqf-orb" style={{ width: 300, height: 300, top: 180, right: -120, background: "radial-gradient(circle, rgba(34,211,238,0.22), transparent 70%)" }} />
      <div className="sqf-orb" style={{ width: 260, height: 260, bottom: -80, left: 40, background: "radial-gradient(circle, rgba(236,72,153,0.16), transparent 70%)" }} />
    </div>
  );
}

/* Adds a soft water-droplet ripple wherever the person taps any .sqf-press
   element. Wraps existing screens without changing their internals. */
function RippleRoot({ children }) {
  const [ripples, setRipples] = useState([]);

  function handleRipple(e) {
    if (!e.target.closest || !e.target.closest(".sqf-press")) return;
    const id = Math.random().toString(36).slice(2);
    const x = e.clientX;
    const y = e.clientY;
    setRipples((r) => [...r, { id, x, y }]);
    setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 650);
  }

  return (
    <div onPointerDown={handleRipple}>
      {children}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 60 }}>
        {ripples.map((r) => (
          <span key={r.id} className="sqf-ripple" style={{ left: r.x, top: r.y }} />
        ))}
      </div>
    </div>
  );
}

function BottomNav({ page, setPage }) {
  const items = [
    { id: "home", label: "Home", icon: Home },
    { id: "find", label: "Find", icon: Search },
    { id: "squads", label: "Squads", icon: Users },
    { id: "leaderboard", label: "Leaderboard", icon: Trophy },
    { id: "profile", label: "Profile", icon: User },
  ];
  return (
    <nav className="sqf-safe-bottom pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-3">
      <div className="sqf-glass-strong pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full px-2 py-2 shadow-2xl">
        {items.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              onClick={() => { haptic(6); setPage(id); }}
              className={`sqf-press sqf-focus relative flex flex-1 flex-col items-center gap-1 rounded-full px-2 py-2 transition-colors ${active ? "text-white" : "text-white/45"}`}
            >
              {active && <span className="absolute inset-0 rounded-full bg-white/10" />}
              <Icon size={20} strokeWidth={active ? 2.4 : 2} className="relative" />
              <span className="relative text-xs font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

.sqf-root {
  --void: #0a0a12;
  --surface: #16172a;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--void);
  color: rgba(255,255,255,0.92);
  min-height: 100dvh;
  position: relative;
  overflow-x: hidden;
}
.sqf-display { font-family: 'Space Grotesk', 'Inter', sans-serif; }

.sqf-glass {
  background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.02));
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 1px solid rgba(255,255,255,0.09);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -12px 20px -16px rgba(255,255,255,0.1), 0 6px 18px rgba(0,0,0,0.18);
}
.sqf-glass-strong {
  background:
    linear-gradient(115deg, rgba(255,255,255,0.20) 0%, transparent 35%, transparent 65%, rgba(255,255,255,0.06) 100%),
    linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03));
  background-size: 220% 220%, 100% 100%;
  background-position: 0% 0%, 0% 0%;
  backdrop-filter: blur(30px) saturate(175%);
  -webkit-backdrop-filter: blur(30px) saturate(175%);
  border: 1px solid rgba(255,255,255,0.15);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -14px 24px -16px rgba(255,255,255,0.12), 0 14px 34px rgba(0,0,0,0.32);
  animation: sqf-liquid-sheen 11s ease-in-out infinite;
}
@keyframes sqf-liquid-sheen {
  0%, 100% { background-position: 0% 0%, 0% 0%; }
  50% { background-position: 100% 55%, 0% 0%; }
}

.sqf-orb { position: absolute; border-radius: 9999px; filter: blur(60px); }

@keyframes sqf-fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.sqf-animate-in { animation: sqf-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both; }

@keyframes sqf-slide-next { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
.sqf-slide-next { animation: sqf-slide-next 0.4s cubic-bezier(0.16,1,0.3,1) both; }

@keyframes sqf-slide-prev { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: translateX(0); } }
.sqf-slide-prev { animation: sqf-slide-prev 0.4s cubic-bezier(0.16,1,0.3,1) both; }

@keyframes sqf-scale-in { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
.sqf-modal-in { animation: sqf-scale-in 0.28s cubic-bezier(0.16,1,0.3,1) both; }

@keyframes sqf-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.sqf-sheet-in { animation: sqf-sheet-up 0.32s cubic-bezier(0.16,1,0.3,1) both; }

@keyframes sqf-toast-in { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
.sqf-toast-in { animation: sqf-toast-in 0.35s cubic-bezier(0.16,1,0.3,1) both; }

@keyframes sqf-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.sqf-skeleton {
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 37%, rgba(255,255,255,0.04) 63%);
  background-size: 400% 100%;
  animation: sqf-shimmer 1.6s ease infinite;
  border-radius: 9999px;
}

@keyframes sqf-pulse-dot { 0%,100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.5); } 50% { box-shadow: 0 0 0 6px rgba(52,211,153,0); } }
.sqf-status-dot-live { animation: sqf-pulse-dot 2s ease infinite; }

@keyframes sqf-ripple-expand { from { transform: scale(1); opacity: 0.85; } to { transform: scale(16); opacity: 0; } }
.sqf-ripple {
  position: absolute;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  margin-top: -5px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(255,255,255,0.6), rgba(139,92,246,0.28) 45%, transparent 72%);
  animation: sqf-ripple-expand 0.65s cubic-bezier(0.16,1,0.3,1) forwards;
}

@keyframes sqf-chat-in { from { opacity: 0; transform: translateY(24px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.sqf-chat-in { animation: sqf-chat-in 0.32s cubic-bezier(0.16,1,0.3,1) both; }

@keyframes sqf-chat-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(16px) scale(0.98); } }
.sqf-chat-out { animation: sqf-chat-out 0.26s cubic-bezier(0.4,0,1,1) both; }

@keyframes sqf-msg-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.sqf-msg-in { animation: sqf-msg-in 0.3s cubic-bezier(0.16,1,0.3,1) both; }

.sqf-scroll::-webkit-scrollbar { display: none; }
.sqf-scroll { -ms-overflow-style: none; scrollbar-width: none; }

.sqf-safe-bottom { padding-bottom: env(safe-area-inset-bottom); }

.sqf-press { transition: transform 0.15s cubic-bezier(0.16,1,0.3,1), opacity 0.15s; }
.sqf-press:active { transform: scale(0.96); opacity: 0.9; }

.sqf-focus:focus-visible { outline: 2px solid rgba(139,92,246,0.8); outline-offset: 2px; }

html, body { scroll-behavior: smooth; }

@media (prefers-reduced-motion: reduce) {
  .sqf-animate-in, .sqf-modal-in, .sqf-sheet-in, .sqf-toast-in, .sqf-skeleton, .sqf-status-dot-live, .sqf-press,
  .sqf-glass-strong, .sqf-slide-next, .sqf-slide-prev, .sqf-ripple, .sqf-chat-in, .sqf-chat-out, .sqf-msg-in {
    animation: none !important;
    transition: none !important;
  }
}
`;

const TAB_ORDER = ["home", "find", "squads", "leaderboard", "profile"];

function App() {
  const [page, setPage] = useState("home");
  const [players, setPlayers] = useState(seedPlayers);
  const [squads, setSquads] = useState(seedSquads);
  const [requests, setRequests] = useState(seedRequests);
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeSquadId, setActiveSquadId] = useState(null);
  const [viewedPlayerId, setViewedPlayerId] = useState(null);
  const [slotPicker, setSlotPicker] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [findFilters, setFindFilters] = useState({ role: "", rank: "", region: "", language: "", playstyle: "", availability: "", lfgStatus: "" });
  const [findSearch, setFindSearch] = useState("");
  const [showFindSheet, setShowFindSheet] = useState(false);
  const [squadFilters, setSquadFilters] = useState({ status: "", roleNeeded: "", rank: "", region: "" });
  const [showSquadSheet, setShowSquadSheet] = useState(false);
  const [lbTab, setLbTab] = useState("squads");
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [direction, setDirection] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [touchStartY, setTouchStartY] = useState(null);
  const [messages, setMessages] = useState(seedMessages);
  const [lastReadBySquad, setLastReadBySquad] = useState({});
  const [chatSquadId, setChatSquadId] = useState(null);
  const [checkStatus, setCheckStatus] = useState("idle");
  const [checkError, setCheckError] = useState(null);
  const [updateManifest, setUpdateManifest] = useState(null);
  const [updateDialogDismissed, setUpdateDialogDismissed] = useState(false);
  const [installStatus, setInstallStatus] = useState("idle");
  const [installError, setInstallError] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [recruitmentPosts, setRecruitmentPosts] = useState(seedRecruitmentPosts);
  const [autoFillSquadId, setAutoFillSquadId] = useState(null);
  const [recruitmentModalSquadId, setRecruitmentModalSquadId] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    loadSession().then((s) => {
      if (!active) return;
      if (s && s.playerId) ME_ID = s.playerId;
      setSession(s);
      setAuthChecked(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadChatData().then((d) => {
      if (!active || !d) return;
      if (Array.isArray(d.messages)) setMessages(d.messages);
      if (d.lastReadBySquad) setLastReadBySquad(d.lastReadBySquad);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadAppData().then((d) => {
      if (active && d) {
        if (Array.isArray(d.players)) setPlayers(d.players);
        if (Array.isArray(d.squads)) setSquads(d.squads);
        if (Array.isArray(d.requests)) setRequests(d.requests);
        if (Array.isArray(d.recruitmentPosts)) setRecruitmentPosts(d.recruitmentPosts);
      }
      if (active) setDataLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dataLoaded) return; // don't overwrite saved data with seed state before the load above finishes
    persistAppData({ players, squads, requests, recruitmentPosts });
  }, [players, squads, requests, recruitmentPosts, dataLoaded]);

  function handleLogout() {
    clearPersistedSession();
    setSession(null);
    setPage("home");
  }

  function handleAuthenticated(authResult) {
    ME_ID = authResult.playerId;
    const existing = players.find((p) => p.id === authResult.playerId);
    const profileComplete = existing ? !!existing.profileComplete : false;
    if (!existing) {
      setPlayers((list) => [...list, createBlankPlayer(authResult.playerId)]);
    }
    const newSession = { type: authResult.type, email: authResult.email, playerId: authResult.playerId, profileComplete };
    setSession(newSession);
    persistSession(newSession);
  }

  async function runUpdateCheck() {
    setCheckStatus("checking");
    setCheckError(null);
    const result = await UpdateProvider.checkForUpdate();
    if (result.status === "available") {
      setUpdateManifest(result.manifest);
      setUpdateDialogDismissed(false);
      setInstallStatus("idle");
      setInstallError(null);
      setCheckStatus("done");
    } else if (result.status === "up-to-date") {
      setUpdateManifest(null);
      setCheckStatus("done");
    } else if (result.status === "unconfigured") {
      setUpdateManifest(null);
      setCheckStatus("unconfigured");
    } else {
      setUpdateManifest(null);
      setCheckStatus("error");
      setCheckError(result.message || "Couldn't check for updates.");
    }
  }

  useEffect(() => {
    runUpdateCheck();
    function handleVisibility() {
      if (document.visibilityState === "visible") runUpdateCheck();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  async function handleUpdateNow() {
    if (!updateManifest) return;
    setInstallStatus("downloading");
    setDownloadProgress(0);
    setInstallError(null);
    haptic(10);
    try {
      await UpdateProvider.downloadAndInstall(updateManifest, (pct) => setDownloadProgress(pct));
      setInstallStatus("downloaded");
    } catch (e) {
      setInstallStatus("error");
      setInstallError((e && e.message) || "Update failed.");
    }
  }

  function handleUpdateLater() {
    haptic(6);
    setUpdateDialogDismissed(true);
  }

  function handlePreviewUpdate() {
    setUpdateManifest({
      latestVersion: "1.1.0",
      apkUrl: "https://example.com/squad-finder.apk",
      changelog: ["Improved Squad Chat", "New squad features", "Bug fixes"],
      forceUpdate: false,
    });
    setUpdateDialogDismissed(false);
    setInstallStatus("idle");
    setInstallError(null);
  }

  const me = players.find((p) => p.id === ME_ID);
  const mySquad = squads.find((s) => s.leaderId === ME_ID || Object.values(s.slots).includes(ME_ID)) || null;

  const stats = useMemo(() => ({
    online: 2481,
    squadsCreated: squads.length + 606,
    squadsComplete: squads.filter(isSquadComplete).length + 342,
    lookingForTeam: players.length + 1080,
  }), [squads, players]);

  function addToast(text) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }

  function navigate(p) {
    if (p === page) return;
    const oldIdx = TAB_ORDER.indexOf(page);
    const newIdx = TAB_ORDER.indexOf(p);
    setDirection(oldIdx !== -1 && newIdx !== -1 ? (newIdx > oldIdx ? 1 : -1) : 0);
    haptic(6);
    setLoading(true);
    setPage(p);
    setTimeout(() => setLoading(false), 380);
  }

  function handleTouchStart(e) {
    if (e.target.closest && e.target.closest(".sqf-scroll")) { setTouchStartX(null); setTouchStartY(null); return; }
    const t = e.touches[0];
    setTouchStartX(t.clientX);
    setTouchStartY(t.clientY);
  }

  function handleTouchEnd(e) {
    if (touchStartX === null || touchStartY === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    setTouchStartX(null);
    setTouchStartY(null);
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const idx = TAB_ORDER.indexOf(page);
    if (idx === -1) return;
    if (dx < 0 && idx < TAB_ORDER.length - 1) navigate(TAB_ORDER[idx + 1]);
    else if (dx > 0 && idx > 0) navigate(TAB_ORDER[idx - 1]);
  }

  function openSquad(id) {
    setActiveSquadId(id);
    navigate("squadDetail");
  }

  function handleCreateSquad({ name, logoEmoji, region, description, yourRole }) {
    const id = "s" + Math.random().toString(36).slice(2, 8);
    const now = Date.now();
    const newSquad = {
      id, name, logoEmoji, region, description, rankTier: me.rank, leaderId: ME_ID, wins: 0,
      slots: { igl: null, rusher: null, support: null, sniper: null },
      createdAt: now, readyState: {},
      memberHistory: [{ playerId: ME_ID, role: yourRole, joinedAt: now, leftAt: null }],
    };
    newSquad.slots[yourRole] = ME_ID;
    setSquads((s) => [newSquad, ...s]);
    haptic(14);
    addToast(`Squad "${name}" created 🎉`);
    openSquad(id);
  }

  function addMemberHistory(squad, playerId, roleId) {
    return [...(squad.memberHistory || []), { playerId, role: roleId, joinedAt: Date.now(), leftAt: null }];
  }
  function closeMemberHistory(squad, playerId) {
    let closedOne = false;
    return (squad.memberHistory || []).map((entry) => {
      if (!closedOne && entry.playerId === playerId && !entry.leftAt) { closedOne = true; return { ...entry, leftAt: Date.now() }; }
      return entry;
    });
  }

  function requireLeader(squad) {
    if (!squad || squad.leaderId !== ME_ID) {
      addToast("Only the squad leader can do that");
      return false;
    }
    return true;
  }

  function handleInvite(player) {
    if (!mySquad) { addToast("Create a squad first"); return; }
    if (!requireLeader(mySquad)) return;
    const roleId = player.role;
    if (mySquad.slots[roleId]) { addToast(`${roleById[roleId].label} slot already filled`); return; }
    if (playerIsInAnySquad(player.id, squads, mySquad.id)) { addToast(`${player.ign} is already in a squad`); return; }
    setSquads((list) => list.map((s) => (s.id === mySquad.id ? { ...s, slots: { ...s.slots, [roleId]: player.id }, memberHistory: addMemberHistory(s, player.id, roleId) } : s)));
    haptic(12);
    addToast(`${player.ign} added as ${roleById[roleId].label} ${roleById[roleId].emoji}`);
    setViewedPlayerId(null);
  }

  function handleSlotTap(roleId) {
    if (!mySquad) return;
    if (!requireLeader(mySquad)) return;
    setSlotPicker({ squadId: mySquad.id, roleId });
  }

  function handlePickForSlot(playerId) {
    const { squadId, roleId } = slotPicker;
    const squad = squads.find((s) => s.id === squadId);
    if (!requireLeader(squad)) { setSlotPicker(null); return; }
    const player = players.find((p) => p.id === playerId);
    if (!squad || !player) { setSlotPicker(null); return; }
    if (squad.slots[roleId]) { addToast(`${roleById[roleId].label} is already filled`); setSlotPicker(null); return; }
    if (playerIsInAnySquad(playerId, squads, squadId)) { addToast(`${player.ign} is already in a squad`); setSlotPicker(null); return; }
    setSquads((list) => list.map((s) => (s.id === squadId ? { ...s, slots: { ...s.slots, [roleId]: playerId }, memberHistory: addMemberHistory(s, playerId, roleId) } : s)));
    haptic(12);
    addToast(`${player.ign} added as ${roleById[roleId].label} ${roleById[roleId].emoji}`);
    setSlotPicker(null);
  }

  function handleAutoFillInvite(roleId, playerId) {
    const squad = squads.find((s) => s.id === autoFillSquadId);
    if (!requireLeader(squad)) return;
    const player = players.find((p) => p.id === playerId);
    if (!squad || !player) return;
    if (squad.slots[roleId]) { addToast(`${roleById[roleId].label} is already filled`); return; }
    if (playerIsInAnySquad(playerId, squads, squad.id)) { addToast(`${player.ign} is already in a squad`); return; }
    setSquads((list) => list.map((s) => (s.id === squad.id ? { ...s, slots: { ...s.slots, [roleId]: playerId }, memberHistory: addMemberHistory(s, playerId, roleId) } : s)));
    haptic(12);
    addToast(`${player.ign} added as ${roleById[roleId].label} ${roleById[roleId].emoji}`);
  }

  function handleRemoveSlot(roleId) {
    if (!mySquad) return;
    if (!requireLeader(mySquad)) return;
    const removedId = mySquad.slots[roleId];
    if (removedId === ME_ID) { addToast('Use "Leave Squad" to leave your own squad'); return; }
    const removedPlayer = players.find((p) => p.id === removedId);
    setSquads((list) => list.map((s) => (s.id === mySquad.id ? { ...s, slots: { ...s.slots, [roleId]: null }, memberHistory: removedId ? closeMemberHistory(s, removedId) : s.memberHistory } : s)));
    if (removedPlayer) addToast(`${removedPlayer.ign} removed from squad`);
  }

  function handleRequestJoin(squad) {
    const exists = requests.some((r) => r.squadId === squad.id && r.playerId === ME_ID && r.status === "pending");
    if (exists) return;

    const post = recruitmentPosts.find((p) => p.squadId === squad.id && p.status === "open");
    if (post) {
      if (!post.roles.includes(me.role)) {
        const advertised = post.roles.map((r) => roleById[r].label).join(", ");
        addToast(`This squad is recruiting: ${advertised}, not ${roleById[me.role].label}.`);
        return;
      }
      const unmet = [];
      if (RANKS.indexOf(me.rank) < RANKS.indexOf(post.minRank)) unmet.push(`${post.minRank}+ rank`);
      if (me.language !== post.language) unmet.push(`${post.language} language`);
      if (me.region !== post.region) unmet.push(`${post.region} region`);
      if (me.availability !== post.availability) unmet.push(`${post.availability} availability`);
      if (me.playstyle !== post.playstyle) unmet.push(`${post.playstyle} playstyle`);
      if (unmet.length > 0) {
        const shown = unmet.slice(0, 2).join(", ") + (unmet.length > 2 ? ` +${unmet.length - 2} more` : "");
        addToast(`Doesn't meet this squad's requirements: ${shown}`);
        return;
      }
    }

    const id = "r" + Math.random().toString(36).slice(2, 8);
    setRequests((r) => [...r, { id, squadId: squad.id, playerId: ME_ID, role: me.role, status: "pending" }]);
    haptic(10);
    addToast(`Request sent to ${squad.name}`);
  }

  function handleAcceptRequest(reqId) {
    const req = requests.find((r) => r.id === reqId);
    if (!req) return;

    if (req.status !== "pending") { addToast("Request already resolved"); return; }

    const squad = squads.find((s) => s.id === req.squadId);
    if (!squad) { addToast("Squad no longer exists"); return; }

    const player = players.find((p) => p.id === req.playerId);
    if (!player) { addToast("Player no longer exists"); return; }

    if (!ROLES.some((r) => r.id === req.role)) { addToast("Invalid role on this request"); return; }

    if (squad.slots[req.role]) { addToast(`${roleById[req.role].label} is already filled`); return; }

    const filledCount = Object.values(squad.slots).filter(Boolean).length;
    if (filledCount >= 4) { addToast("Squad is already full"); return; }

    const alreadyInThisSquad = squad.leaderId === req.playerId || Object.values(squad.slots).includes(req.playerId);
    if (alreadyInThisSquad) { addToast(`${player.ign} is already in this squad`); return; }

    if (playerIsInAnySquad(req.playerId, squads, squad.id)) { addToast(`${player.ign} is already in a squad`); return; }

    if (squad.leaderId !== ME_ID) { addToast("Only the squad leader can do that"); return; }

    setSquads((list) => list.map((s) => (s.id === req.squadId ? { ...s, slots: { ...s.slots, [req.role]: req.playerId }, memberHistory: addMemberHistory(s, req.playerId, req.role) } : s)));
    setRequests((list) => list.filter((r) => r.id !== reqId));
    haptic(14);
    addToast(`${player.ign} joined your squad`);
  }

  function handleRejectRequest(reqId) {
    const req = requests.find((r) => r.id === reqId);
    if (!req) return;
    const squad = squads.find((s) => s.id === req.squadId);
    if (!requireLeader(squad)) return;
    setRequests((list) => list.filter((r) => r.id !== reqId));
    addToast("Request declined");
  }

  function handleLeaveSquad(squadId) {
    const squad = squads.find((s) => s.id === squadId);
    if (!squad) return;

    if (squad.leaderId === ME_ID) {
      const nextLeaderRole = ROLES.map((r) => r.id).find((roleId) => squad.slots[roleId] && squad.slots[roleId] !== ME_ID);
      if (!nextLeaderRole) {
        setSquads((list) => list.filter((s) => s.id !== squadId));
        setRequests((list) => list.filter((r) => r.squadId !== squadId));
        setRecruitmentPosts((list) => list.filter((p) => p.squadId !== squadId));
        addToast("Squad closed — you were the only member");
        navigate("squads");
        return;
      }
      const newLeaderId = squad.slots[nextLeaderRole];
      const newLeaderPlayer = players.find((p) => p.id === newLeaderId);
      setSquads((list) => list.map((s) => {
        if (s.id !== squadId) return s;
        const slots = { ...s.slots };
        Object.keys(slots).forEach((k) => { if (slots[k] === ME_ID) slots[k] = null; });
        const readyState = { ...(s.readyState || {}) };
        delete readyState[ME_ID];
        return { ...s, slots, readyState, leaderId: newLeaderId, memberHistory: closeMemberHistory(s, ME_ID) };
      }));
      addToast(`You left — ${newLeaderPlayer ? newLeaderPlayer.ign : "a teammate"} is now squad leader`);
      navigate("squads");
      return;
    }

    setSquads((list) => list.map((s) => {
      if (s.id !== squadId) return s;
      const slots = { ...s.slots };
      Object.keys(slots).forEach((k) => { if (slots[k] === ME_ID) slots[k] = null; });
      const readyState = { ...(s.readyState || {}) };
      delete readyState[ME_ID];
      return { ...s, slots, readyState, memberHistory: closeMemberHistory(s, ME_ID) };
    }));
    addToast("You left the squad");
    navigate("squads");
  }

  function handleUpdateProfile(data) {
    setPlayers((list) => list.map((p) => (p.id === ME_ID ? { ...p, ...data } : p)));
    setEditingProfile(false);
    addToast("Profile updated");
  }

  function handleCompleteProfile(data) {
    setPlayers((list) => list.map((p) => (p.id === ME_ID ? { ...p, ...data, profileComplete: true } : p)));
    if (session) {
      const updatedSession = { ...session, profileComplete: true };
      setSession(updatedSession);
      persistSession(updatedSession);
    }
    addToast("Profile saved");
  }

  function handleSetLfgStatus(statusId) {
    haptic(6);
    setPlayers((list) => list.map((p) => (p.id === ME_ID ? { ...p, lfgStatus: statusId } : p)));
  }

  function hasUnreadMessages(squadId) {
    const lastRead = lastReadBySquad[squadId] || 0;
    return messages.some((m) => m.squadId === squadId && m.senderId !== ME_ID && m.ts > lastRead);
  }

  function handleOpenChat(squadId) {
    haptic(8);
    const updatedRead = { ...lastReadBySquad, [squadId]: Date.now() };
    setLastReadBySquad(updatedRead);
    persistChatData({ messages, lastReadBySquad: updatedRead });
    setChatSquadId(squadId);
  }

  function handleCloseChat() {
    setChatSquadId(null);
  }

  function handleSendMessage(squadId, text, type) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const finalType = type === "announcement" ? "announcement" : "text";
    if (finalType === "announcement") {
      const squad = squads.find((s) => s.id === squadId);
      if (!requireLeader(squad)) return;
    }
    const newMsg = { id: "m" + Math.random().toString(36).slice(2, 8), squadId, senderId: ME_ID, text: trimmed, ts: Date.now(), type: finalType };
    const updated = [...messages, newMsg];
    setMessages(updated);
    persistChatData({ messages: updated, lastReadBySquad });
  }

  function handleToggleReady() {
    if (!chatSquadId) return;
    haptic(8);
    const squad = squads.find((s) => s.id === chatSquadId);
    const nowReady = !(squad && squad.readyState && squad.readyState[ME_ID]);
    setSquads((list) => list.map((s) => (s.id === chatSquadId ? { ...s, readyState: { ...(s.readyState || {}), [ME_ID]: nowReady } } : s)));
    const sysMsg = { id: "m" + Math.random().toString(36).slice(2, 8), squadId: chatSquadId, senderId: ME_ID, text: `${me.ign} is ${nowReady ? "Ready ✅" : "Not Ready"}`, ts: Date.now(), type: "system" };
    const updated = [...messages, sysMsg];
    setMessages(updated);
    persistChatData({ messages: updated, lastReadBySquad });
  }

  function handleSendMatchStarting() {
    if (!chatSquadId) return;
    const squad = squads.find((s) => s.id === chatSquadId);
    if (!requireLeader(squad)) return;
    const msg = { id: "m" + Math.random().toString(36).slice(2, 8), squadId: chatSquadId, senderId: ME_ID, text: "Match is starting!", ts: Date.now(), type: "matchStarting" };
    const updated = [...messages, msg];
    setMessages(updated);
    persistChatData({ messages: updated, lastReadBySquad });
  }

  function handleSaveRecruitmentPost(data) {
    const squadId = recruitmentModalSquadId;
    const squad = squads.find((s) => s.id === squadId);
    if (!requireLeader(squad)) { setRecruitmentModalSquadId(null); return; }
    const validRoles = data.roles.filter((r) => missingRoles(squad).includes(r));
    if (validRoles.length === 0) { addToast("Pick at least one currently-open role"); return; }
    const finalData = { ...data, roles: validRoles };
    setRecruitmentPosts((list) => {
      const existingIdx = list.findIndex((p) => p.squadId === squadId);
      if (existingIdx === -1) {
        const id = "rp" + Math.random().toString(36).slice(2, 8);
        return [...list, { id, squadId, status: "open", createdAt: Date.now(), ...finalData }];
      }
      return list.map((p, i) => (i === existingIdx ? { ...p, ...finalData } : p));
    });
    haptic(10);
    addToast("Recruitment post saved");
    setRecruitmentModalSquadId(null);
  }

  function handleCloseRecruitmentPost(squadId) {
    const squad = squads.find((s) => s.id === squadId);
    if (!requireLeader(squad)) return;
    setRecruitmentPosts((list) => list.map((p) => (p.squadId === squadId ? { ...p, status: "closed" } : p)));
    addToast("Recruitment post closed");
  }

  function handleReopenRecruitmentPost(squadId) {
    const squad = squads.find((s) => s.id === squadId);
    if (!requireLeader(squad)) return;
    setRecruitmentPosts((list) => list.map((p) => (p.squadId === squadId ? { ...p, status: "open" } : p)));
    addToast("Recruitment post reopened");
  }

  const activeSquad = squads.find((s) => s.id === activeSquadId) || null;
  const viewedPlayer = players.find((p) => p.id === viewedPlayerId) || null;
  const chatSquad = squads.find((s) => s.id === chatSquadId) || null;
  const chatAccessAllowed = chatSquad ? (chatSquad.leaderId === ME_ID || Object.values(chatSquad.slots).includes(ME_ID)) : false;
  const autoFillSquad = squads.find((s) => s.id === autoFillSquadId) || null;
  const recruitmentModalSquad = squads.find((s) => s.id === recruitmentModalSquadId) || null;
  const recruitmentPostForModal = recruitmentModalSquadId ? recruitmentPosts.find((p) => p.squadId === recruitmentModalSquadId) || null : null;

  if (!authChecked) {
    return (
      <div className="sqf-root relative flex min-h-dvh w-full items-center justify-center">
        <style>{GLOBAL_CSS}</style>
        <BackgroundOrbs />
        <div className="sqf-display relative text-sm text-white/40" style={{ zIndex: 10 }}>Squad Finder</div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  if (!me.profileComplete) {
    return <ProfileSetupScreen me={me} onComplete={handleCompleteProfile} />;
  }

  return (
    <RippleRoot>
    <div className="sqf-root relative min-h-dvh w-full">
      <style>{GLOBAL_CSS}</style>
      <BackgroundOrbs />
      <div
        className="relative mx-auto max-w-md pb-32 sm:max-w-2xl"
        style={{ zIndex: 10 }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div key={page} className={direction === 1 ? "sqf-slide-next" : direction === -1 ? "sqf-slide-prev" : "sqf-animate-in"}>
          {page === "home" && <HomePage stats={stats} onFind={() => navigate("find")} onCreate={() => navigate("createSquad")} onQuickMatch={() => navigate("quickMatch")} />}
          {page === "find" && (
            <FindPlayersPage
              players={players} me={me} mySquad={mySquad}
              onView={(id) => setViewedPlayerId(id)} onInvite={handleInvite}
              filters={findFilters} setFilters={setFindFilters}
              search={findSearch} setSearch={setFindSearch}
              showSheet={showFindSheet} setShowSheet={setShowFindSheet}
              loading={loading}
            />
          )}
          {page === "createSquad" && <CreateSquadPage me={me} onCreate={handleCreateSquad} />}
          {page === "squads" && (
            <SquadDirectoryPage
              squads={squads} players={players} recruitmentPosts={recruitmentPosts}
              filters={squadFilters} setFilters={setSquadFilters}
              showSheet={showSquadSheet} setShowSheet={setShowSquadSheet}
              loading={loading} onOpen={openSquad}
            />
          )}
          {page === "quickMatch" && (
            <QuickMatchPage me={me} squads={squads} players={players} onBack={() => navigate("home")} onOpenSquad={openSquad} />
          )}
          {page === "squadDetail" && activeSquad && (
            <SquadDetailPage
              squad={activeSquad} players={players} me={me}
              isMine={mySquad?.id === activeSquad.id}
              isLeaderView={activeSquad.leaderId === ME_ID}
              requests={requests}
              recruitmentPost={recruitmentPosts.find((p) => p.squadId === activeSquad.id) || null}
              onBack={() => navigate(mySquad?.id === activeSquad.id ? "profile" : "squads")}
              onSlotTap={handleSlotTap}
              onRemoveSlot={handleRemoveSlot}
              onRequestJoin={() => handleRequestJoin(activeSquad)}
              onLeave={() => handleLeaveSquad(activeSquad.id)}
              onAcceptRequest={handleAcceptRequest}
              onRejectRequest={handleRejectRequest}
              onViewPlayer={(id) => setViewedPlayerId(id)}
              onOpenChat={() => handleOpenChat(activeSquad.id)}
              hasUnread={hasUnreadMessages(activeSquad.id)}
              onOpenAutoFill={() => setAutoFillSquadId(activeSquad.id)}
              onManagePost={() => setRecruitmentModalSquadId(activeSquad.id)}
              onClosePost={() => handleCloseRecruitmentPost(activeSquad.id)}
              onReopenPost={() => handleReopenRecruitmentPost(activeSquad.id)}
            />
          )}
          {page === "leaderboard" && (
            <LeaderboardPage players={players} squads={squads} tab={lbTab} setTab={setLbTab} onViewPlayer={(id) => setViewedPlayerId(id)} onOpenSquad={openSquad} />
          )}
          {page === "profile" && (
            <ProfilePage
              me={me} mySquad={mySquad}
              onEdit={() => setEditingProfile(true)}
              onOpenSquad={() => mySquad && openSquad(mySquad.id)}
              session={session} onLogout={handleLogout}
              checkStatus={checkStatus}
              checkError={checkError}
              hasUpdateAvailable={!!updateManifest}
              onCheckForUpdate={runUpdateCheck}
              onPreviewUpdate={handlePreviewUpdate}
              onSetLfgStatus={handleSetLfgStatus}
            />
          )}
        </div>
      </div>

      <BottomNav page={page} setPage={navigate} />

      {viewedPlayer && (
        <PlayerSheet
          player={viewedPlayer}
          onClose={() => setViewedPlayerId(null)}
          inviteState={viewedPlayer.id !== ME_ID ? inviteStateFor(viewedPlayer, mySquad) : null}
          onInvite={() => handleInvite(viewedPlayer)}
        />
      )}

      {slotPicker && (
        <SlotPickerModal
          squad={squads.find((s) => s.id === slotPicker.squadId)}
          roleId={slotPicker.roleId}
          players={players}
          onPick={handlePickForSlot}
          onClose={() => setSlotPicker(null)}
        />
      )}

      {editingProfile && <EditProfileModal me={me} onSave={handleUpdateProfile} onClose={() => setEditingProfile(false)} />}

      {autoFillSquad && (
        <AutoFillModal
          squad={autoFillSquad}
          players={players}
          onInvite={handleAutoFillInvite}
          onClose={() => setAutoFillSquadId(null)}
        />
      )}

      {recruitmentModalSquad && (
        <RecruitmentPostModal
          squad={recruitmentModalSquad}
          existingPost={recruitmentPostForModal}
          onSave={handleSaveRecruitmentPost}
          onClose={() => setRecruitmentModalSquadId(null)}
        />
      )}

      {chatSquad && chatAccessAllowed && (
        <SquadChatScreen
          squad={chatSquad}
          players={players}
          me={me}
          messages={messages}
          isLeaderView={chatSquad.leaderId === ME_ID}
          onSend={(text, type) => handleSendMessage(chatSquad.id, text, type)}
          onToggleReady={handleToggleReady}
          onSendMatchStarting={handleSendMatchStarting}
          onClose={handleCloseChat}
        />
      )}

      <ToastStack toasts={toasts} />

      {updateManifest && (!updateDialogDismissed || updateManifest.forceUpdate) && (
        <UpdateDialog
          manifest={updateManifest}
          installStatus={installStatus}
          downloadProgress={downloadProgress}
          installError={installError}
          onUpdateNow={handleUpdateNow}
          onLater={handleUpdateLater}
          onRetry={handleUpdateNow}
        />
      )}
    </div>
    </RippleRoot>
  );
}

export default App;
