// Fetches the TTC GTFS-realtime service-alerts feed (Protocol Buffer format),
// decodes it, keeps subway/LRT alerts, and writes a small alerts.json the
// browser widget can read from your own GitHub Pages origin (no CORS, no protobuf
// decoding in the browser).
//
// Runs in GitHub Actions, not the browser — so there's no CORS restriction here.

const fs = require("fs");
const path = require("path");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

const ALERTS_URL = "https://bustime.ttc.ca/gtfsrt/alerts";

// How far ahead to list planned closures.
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

// TTC rapid-transit lines. The feed labels routes by these short names / ids.
// We match generously (route short name OR anything containing "Line N")
// because agencies aren't always consistent about how routes appear in alerts.
const SUBWAY_ROUTE_NAMES = new Set(["1", "2", "3", "4", "5", "6"]);
const LINE_LABELS = {
  "1": "Line 1 Yonge-University",
  "2": "Line 2 Bloor-Danforth",
  "3": "Line 3 Scarborough",
  "4": "Line 4 Sheppard",
  "5": "Line 5 Eglinton",
  "6": "Line 6 Finch West",
};

// GTFS-realtime translated strings come as { translation: [{ text, language }] }.
// Pull the English text (or the first available).
function pickText(translatedString) {
  if (!translatedString || !translatedString.translation) return "";
  const translations = translatedString.translation;
  const en = translations.find((t) => (t.language || "").toLowerCase().startsWith("en"));
  return (en || translations[0] || {}).text || "";
}

// Map GTFS-realtime enum values to readable words.
const EFFECT_LABELS = {
  1: "No service",
  2: "Reduced service",
  3: "Significant delays",
  4: "Detour",
  5: "Additional service",
  6: "Modified service",
  7: "Other",
  8: "Unknown",
  9: "Stop moved",
  10: "No effect",
  11: "Accessibility issue",
};

function looksLikeSubwayAlert(entity) {
  const informed = (entity.alert && entity.alert.informedEntity) || [];
  return informed.some((ie) => {
    const rid = (ie.routeId || "").trim();
    const rst = (ie.routeShortName || "").trim();
    if (SUBWAY_ROUTE_NAMES.has(rid) || SUBWAY_ROUTE_NAMES.has(rst)) return true;
    // routeType 1 == subway/metro in GTFS
    if (ie.routeType === 1) return true;
    return false;
  });
}

function affectedLines(entity) {
  const informed = (entity.alert && entity.alert.informedEntity) || [];
  const lines = new Set();
  for (const ie of informed) {
    const key = (ie.routeId || ie.routeShortName || "").trim();
    if (LINE_LABELS[key]) lines.add(LINE_LABELS[key]);
  }
  return [...lines];
}

async function main() {
  let entities = [];
  let feedTimestamp = null;

  try {
    const res = await fetch(ALERTS_URL, {
      headers: { "User-Agent": "ttc-alerts-widget (github actions)" },
    });
    if (!res.ok) throw new Error(`Feed responded ${res.status}`);
    const buffer = new Uint8Array(await res.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    entities = feed.entity || [];
    if (feed.header && feed.header.timestamp) {
      feedTimestamp = Number(feed.header.timestamp) * 1000;
    }
  } catch (err) {
    // Don't overwrite good data with nothing on a transient failure.
    // Keep the previous alerts.json and just note that the fetch failed.
    console.error("Fetch/decode failed:", err.message);
    const outPath = path.join(__dirname, "..", "alerts.json");
    let prev = { alerts: [], planned: [] };
    try {
      prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch (_) {}
    if (!Array.isArray(prev.alerts)) prev.alerts = [];
    if (!Array.isArray(prev.planned)) prev.planned = [];
    prev.updatedAt = new Date().toISOString();
    prev.fetchError = err.message;
    fs.writeFileSync(outPath, JSON.stringify(prev, null, 2));
    return;
  }

  const now = Date.now();

  const alerts = entities
    .filter((e) => e.alert && looksLikeSubwayAlert(e))
    .map((e) => {
      const a = e.alert;
      // Keep only currently-active periods when they're specified.
      const periods = a.activePeriod || [];

      // Classify the alert by when its active period falls.
      // - active now: some period covers the current moment (or no period given)
      // - planned:    the earliest period starts in the future, within the window
      // We track the earliest upcoming start so the widget can show a date.
      let active = periods.length === 0;
      let upcomingStart = null; // ms
      let upcomingEnd = null;   // ms
      for (const p of periods) {
        const start = p.start ? Number(p.start) * 1000 : -Infinity;
        const end = p.end ? Number(p.end) * 1000 : Infinity;
        if (now >= start && now <= end) {
          active = true;
        } else if (start > now) {
          if (upcomingStart === null || start < upcomingStart) {
            upcomingStart = start;
            upcomingEnd = end === Infinity ? null : end;
          }
        }
      }

      const planned =
        !active &&
        upcomingStart !== null &&
        upcomingStart <= now + WINDOW_MS;

      return {
        id: e.id,
        lines: affectedLines(e),
        header: pickText(a.headerText),
        description: pickText(a.descriptionText),
        effect: EFFECT_LABELS[a.effect] || "Service alert",
        url: pickText(a.url),
        active,
        planned,
        startsAt: upcomingStart ? new Date(upcomingStart).toISOString() : null,
        endsAt: upcomingEnd ? new Date(upcomingEnd).toISOString() : null,
      };
    })
    .filter((a) => (a.active || a.planned) && (a.header || a.description));

  const activeAlerts = alerts.filter((a) => a.active);
  // Sort planned closures by start date so the soonest is first.
  const plannedAlerts = alerts
    .filter((a) => a.planned)
    .sort((x, y) => new Date(x.startsAt) - new Date(y.startsAt));

  const out = {
    updatedAt: new Date().toISOString(),
    feedTimestamp: feedTimestamp ? new Date(feedTimestamp).toISOString() : null,
    windowDays: WINDOW_DAYS,
    count: activeAlerts.length,
    plannedCount: plannedAlerts.length,
    alerts: activeAlerts,
    planned: plannedAlerts,
  };

  const outPath = path.join(__dirname, "..", "alerts.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    `Wrote ${activeAlerts.length} active + ${plannedAlerts.length} planned subway/LRT alert(s).`
  );
}

main();
