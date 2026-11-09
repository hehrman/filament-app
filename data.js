// How the app reads and writes Filament's data.
//
// GitHub mode (normal use): data lives in the private repository; the app
// talks to GitHub's API with a personal access token that stays in this
// browser only (localStorage) and is sent to nobody but api.github.com.
//
// Local mode (?local=1): reads ./data/*.json next to the app and keeps edits
// in this browser. Used for previews and automated tests.

const API = "https://api.github.com";
const CFG_KEY = "filament.connection.v1";
const CACHE_KEY = "filament.cache.v1";
const FILES = ["settings.json", "status.json", "history.json", "listings.json", "catalog.json"];

const safe = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function loadConnection() { return safe.get(CFG_KEY); }
export function saveConnection(c) { safe.set(CFG_KEY, c); }
export function forgetConnection() { safe.del(CFG_KEY); safe.del(CACHE_KEY); }
export function cached() { return safe.get(CACHE_KEY); }

export function isLocal() { return new URLSearchParams(location.search).has("local"); }

class GitHubSource {
  constructor({ owner, repo, token, branch = "main" }) {
    Object.assign(this, { owner, repo, token, branch });
    this.shas = {};
  }
  get label() { return `${this.owner}/${this.repo}`; }

  async req(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        Accept: "application/vnd.github+json",
        ...(opts.headers || {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = `GitHub said ${res.status}`;
      try { const j = await res.json(); if (j.message) msg += `: ${j.message}`; } catch { /* no body */ }
      if (res.status === 401) msg = "GitHub didn't accept the access token (it may have expired). Reconnect in Settings.";
      if (res.status === 404) msg = `Couldn't find ${this.label} (or the token can't see it).`;
      throw new ApiError(msg, res.status);
    }
    return res.status === 204 ? null : res;
  }

  async verify() {
    const r = await (await this.req(`/repos/${this.owner}/${this.repo}`)).json();
    this.branch = r.default_branch || this.branch;
    return r;
  }

  async readFile(name) {
    try {
      const r = await this.req(
        `/repos/${this.owner}/${this.repo}/contents/data/${name}?ref=${this.branch}`,
        { headers: { Accept: "application/vnd.github.raw+json" } });
      return JSON.parse(await r.text());
    } catch (e) {
      if (e.status === 404 && name !== "settings.json") return null;
      throw e;
    }
  }

  async readSettingsWithSha() {
    const r = await (await this.req(`/repos/${this.owner}/${this.repo}/contents/data/settings.json?ref=${this.branch}`)).json();
    return { settings: JSON.parse(b64decode(r.content)), sha: r.sha };
  }

  async writeSettings(settings, sha, message) {
    const body = { message, content: b64encode(JSON.stringify(settings, null, 2) + "\n"), sha, branch: this.branch };
    const r = await (await this.req(`/repos/${this.owner}/${this.repo}/contents/data/settings.json`, {
      method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })).json();
    return r.content.sha;
  }

  async dispatch(mode = "check-now") {
    await this.req(`/repos/${this.owner}/${this.repo}/actions/workflows/scan.yml/dispatches`, {
      method: "POST", body: JSON.stringify({ ref: this.branch, inputs: { mode } }),
      headers: { "Content-Type": "application/json" } });
  }

  async activeRun() {
    const r = await (await this.req(
      `/repos/${this.owner}/${this.repo}/actions/workflows/scan.yml/runs?per_page=6`)).json();
    return (r.workflow_runs || []).find((x) => ["queued", "in_progress", "waiting", "pending"].includes(x.status)
      && (x.event === "workflow_dispatch" || x.event === "schedule")) || null;
  }

  async lastRun() {
    const r = await (await this.req(
      `/repos/${this.owner}/${this.repo}/actions/workflows/scan.yml/runs?per_page=1&event=workflow_dispatch`)).json();
    return (r.workflow_runs || [])[0] || null;
  }
}

class LocalSource {
  constructor() { this.label = "local preview"; this.overlay = safe.get("filament.local.settings"); }
  async verify() { return {}; }
  async readFile(name) {
    if (name === "settings.json" && this.overlay) return this.overlay;
    const r = await fetch(`./data/${name}`, { cache: "no-store" });
    return r.ok ? r.json() : null;
  }
  async readSettingsWithSha() { return { settings: await this.readFile("settings.json"), sha: "local" }; }
  async writeSettings(s) { this.overlay = s; safe.set("filament.local.settings", s); return "local"; }
  async dispatch() { this.fakeRunUntil = Date.now() + 4000; }
  async activeRun() { return this.fakeRunUntil && Date.now() < this.fakeRunUntil ? { status: "in_progress" } : null; }
  async lastRun() { return null; }
}

export function makeSource(conn) {
  return isLocal() ? new LocalSource() : new GitHubSource(conn);
}

export async function loadAll(src) {
  const out = {};
  await Promise.all(FILES.map(async (f) => { out[f.replace(".json", "")] = await src.readFile(f); }));
  safe.set(CACHE_KEY, { at: Date.now(), data: out });
  return out;
}

// Read-modify-write so edits from the Mac and iPhone never overwrite each other.
export async function mutateSettings(src, fn, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { settings, sha } = await src.readSettingsWithSha();
    fn(settings);
    try {
      await src.writeSettings(settings, sha, message);
      return settings;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;   // someone else saved first: retry
    }
  }
  throw new ApiError("Couldn't save — please try again.", 409);
}
