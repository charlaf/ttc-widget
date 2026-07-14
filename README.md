# TTC Subway Live Status — Notion widget

A small, self-updating widget showing live TTC subway/LRT service alerts. It embeds
in a Notion page the same way your weather widget does.

## How it works (and why it's built this way)

A browser can't fetch the TTC feed directly — the feed is CORS-restricted and comes
in binary Protocol Buffer format. So the fetching happens **server-side in GitHub
Actions** instead:

1. A scheduled Action runs `scripts/fetch-alerts.js` every ~10 minutes.
2. That script downloads the TTC GTFS-realtime alerts feed, decodes it, keeps only
   subway/LRT alerts, and writes a small `alerts.json`.
3. The Action commits `alerts.json` back to the repo.
4. `index.html` (served on GitHub Pages) polls that `alerts.json` every 60s and
   renders it. Same origin, plain JSON — no CORS, no protobuf in the browser.

## One-time setup

1. **Create a repo** and drop these files in at the root:
   ```
   index.html
   alerts.json
   package.json
   scripts/fetch-alerts.js
   .github/workflows/update-alerts.yml
   ```

2. **Enable GitHub Pages**: repo → Settings → Pages → Source: *Deploy from a branch*
   → branch `main`, folder `/ (root)` → Save. Your widget will be at
   `https://YOURNAME.github.io/REPO/`.

3. **Allow Actions to write**: Settings → Actions → General → *Workflow permissions*
   → select **Read and write permissions** → Save. (This lets the workflow commit
   `alerts.json`.)

4. **Kick off the first run**: Actions tab → "Update TTC subway alerts" → *Run workflow*.
   Confirm it commits an updated `alerts.json`.

5. **Embed in Notion**: type `/embed` on your page, paste
   `https://YOURNAME.github.io/REPO/`, and size it (≈520px wide works well).

Because `index.html` and `alerts.json` sit in the same repo, the default
`ALERTS_URL = "./alerts.json"` already works. Only change it if you host the JSON
somewhere else.

## What it shows

The widget has two sections, both from the same TTC realtime feed:

- **Active now** — delays, diversions, and closures currently in effect.
- **Planned · next 7 days** — full weekend closures, early closures, late openings,
  and single-track operations that are scheduled to start within the coming week.
  These come from alerts in the feed that carry a future `activePeriod`; the script
  keeps any starting within 7 days and sorts them soonest-first. Change the window
  by editing `WINDOW_DAYS` in `scripts/fetch-alerts.js`.

## Notes & caveats

- **Timing of planned postings**: the TTC typically publishes weekend track-work
  closures only a few days ahead, so a given weekend may show nothing until midweek.
  An empty planned section means none are announced yet, not that the widget failed.
- **Schedule timing**: GitHub's cron is best-effort and can lag a few minutes under
  load. Every 10 minutes is a reasonable balance; going below 5 isn't allowed.
- **Feed access**: if the Action ever logs a 403/timeout, the script preserves the
  last good `alerts.json` and records `fetchError` rather than blanking the widget.
- **Attribution**: the feed is licensed under the Open Government Licence – Toronto.
  The footer link back to ttc.ca satisfies attribution and gives readers the
  official source.

## Local test (optional)

```bash
npm install
node scripts/fetch-alerts.js   # writes alerts.json
```
