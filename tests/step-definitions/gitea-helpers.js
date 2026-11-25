'use strict';

// Shared helpers for the step files of this pack.
//
// Not a step file: it registers no step definitions and no hooks. It holds the plumbing the steps use and that
// another pack can require instead of copying: the wait budget, presence assertions with friendly errors, URL
// building, the users registry, signing in (the form, and a session put back), the forge's REST API as the managing
// account (the test content a scenario makes and removes), and the issues a scenario made, which go after it.
//
// One pack serves Gitea and Forgejo. Forgejo is a fork of Gitea that keeps its API, its addresses and most of its
// screens; where the two draw a control differently (Forgejo 17 is built on Gitea 1.22, Gitea 1.27 has a newer issue
// sidebar), the helpers below look for either, and CI runs every step on both.
//
// Everything here builds on webship-js's own helpers (`gotoUrl`, `smartSettle`, `waitForPageLoad`, `friendly`) so the
// steps behave like the core webship-js steps.

const { gotoUrl, smartSettle, waitForPageLoad, friendly } = require('webship-js/tests/step-definitions/webship');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require(require.resolve('playwright', { paths: [require.resolve('webship-js/package.json')] })); }

/**
 * The per-assertion wait budget: `minWaitTime.page` from cucumber.js, at least 10 seconds, so a slow page does not fail
 * an assertion that would pass a moment later. Kept below webship-js's 45 second step timeout.
 *
 * @param {object} world
 * @returns {number}
 */
function budget(world) {
  return Math.max((world && world.minWaitTime && world.minWaitTime.page) || 0, 10000);
}

/**
 * Escape a literal string for use in a RegExp.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A RegExp that matches the whole text (ignoring surrounding space and case), for exact names and labels.
 *
 * @param {string} text
 * @returns {RegExp}
 */
function exactly(text) {
  return new RegExp('^\\s*' + escapeRegExp(text) + '\\s*$', 'i');
}

/**
 * Collapse runs of white space and trim.
 *
 * @param {string} text
 * @returns {string}
 */
function tidy(text) {
  return String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * Run an action and rethrow its failure as a friendly error (action, target, cause and a hint) instead of
 * Playwright's raw timeout stack.
 *
 * @param {string} label
 * @param {string} target
 * @param {Function} fn
 * @param {string} hint
 */
async function actOrExplain(label, target, fn, hint) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.stack === err.message && /Hint:/.test(err.message)) throw err;
    throw friendly({ action: label, target, cause: err, hint });
  }
}

/**
 * Wait until a locator has (or, with `notCase`, no longer has) a visible match and fail with a friendly error
 * otherwise: the wait and the assertion are one call, so content that arrives a moment late still passes.
 *
 * @param {import('playwright').Locator} locator
 * @param {string|null|undefined} notCase
 * @param {{label: string, hint: string, timeout: number}} options
 */
async function assertPresence(locator, notCase, { label, hint, timeout }) {
  try {
    await locator.first().waitFor({ state: notCase ? 'hidden' : 'visible', timeout });
  } catch {
    throw friendly({
      message: notCase ? `Expected not to see ${label}, but it is still on the page.` : `Expected to see ${label}, but it did not appear within ${timeout} ms.`,
      hint,
    });
  }
}

/**
 * Poll a reader until its value satisfies a test, and return the last value read, so a value that changes a moment
 * after the action (a status after a move) still passes.
 *
 * @param {Function} read - async () => value
 * @param {Function} test - (value) => boolean
 * @param {number} timeout
 * @returns {Promise<{ok: boolean, value: *}>}
 */
async function waitForValue(read, test, timeout) {
  const deadline = Date.now() + timeout;
  let value;
  for (;;) {
    try { value = await read(); } catch { value = undefined; }
    if (value !== undefined && test(value)) return { ok: true, value };
    if (Date.now() >= deadline) return { ok: false, value };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * The site root without a trailing slash.
 *
 * @param {object} world
 * @returns {string}
 */
function siteRoot(world) {
  return String(world.launchUrl).replace(/\/+$/, '');
}

/**
 * Join the site root and a path with exactly one slash. Absolute URLs pass through.
 *
 * @param {object} world
 * @param {string} url
 * @returns {string}
 */
function siteUrl(world, url) {
  if (!url) return siteRoot(world);
  if (/^https?:\/\//i.test(url)) return url;
  return siteRoot(world) + '/' + String(url).replace(/^\/+/, '');
}

/**
 * Open a page of the site and wait for it to settle.
 *
 * @param {object} world
 * @param {string} url
 */
async function open(world, url) {
  await gotoUrl(world.page, siteUrl(world, url));
  await world.page.waitForSelector('body', { state: 'attached', timeout: budget(world) });
  await waitForPageLoad(world.page, (world.minWaitTime && world.minWaitTime.page) || 3000);
}

/**
 * A user of the `users` registry in cucumber.js (`worldParameters.users`).
 *
 * @param {object} world
 * @param {string} handle
 * @returns {{username: string, password: string, name: string}}
 */
function resolveUser(world, handle) {
  const users = (world.parameters && world.parameters.users) || {};
  const entry = users[handle];
  if (!entry) {
    throw friendly({
      message: `The account "${handle}" is not in the users registry. Known accounts: ${Object.keys(users).join(', ') || '(none)'}.`,
      hint: `Add it to worldParameters.users in cucumber.js: users: { ${handle}: { username: '...', password: process.env.GITEA_${handle.toUpperCase()}_PASSWORD, name: '...' } }. The account itself is made once by the build of the site, never by a feature.`,
    });
  }
  const username = entry.username || handle;
  const password = typeof entry === 'string' ? entry : entry.password;
  if (!password) {
    throw friendly({
      message: `The account "${handle}" has no password in the users registry.`,
      hint: `Set worldParameters.users.${handle}.password in cucumber.js, from an environment variable.`,
    });
  }
  return { username, password, name: entry.name || '' };
}

/**
 * The front page as the browser's session sees it (the session's cookies, never a page change): its status and HTML.
 *
 * @param {object} world
 * @returns {Promise<{status: number, html: string}>}
 */
async function frontPage(world) {
  const r = await world.context.request.get(siteUrl(world, '/'), { ignoreHTTPSErrors: true, failOnStatusCode: false }).catch(() => null);
  if (!r) return { status: 0, html: '' };
  return { status: r.status(), html: await r.text().catch(() => '') };
}

/**
 * The login of the account the browser's session is of, from the forge's own account menu ("Signed in as <login>");
 * an empty string for a visitor.
 *
 * @param {object} world
 * @returns {Promise<string>}
 */
async function currentUser(world) {
  const { html } = await frontPage(world);
  const m = html.match(/Signed in as\s*<strong>([^<]+)<\/strong>/);
  return m ? m[1].trim() : '';
}

/**
 * The name the forge shows for the account the browser's session is of: its full name, which the title of its own
 * dashboard carries; an empty string for a visitor.
 *
 * @param {object} world
 * @returns {Promise<string>}
 */
async function currentName(world) {
  const { html } = await frontPage(world);
  if (!/Signed in as\s*<strong>/.test(html)) return '';
  const m = html.match(/<title>\s*([^<]*?) - Dashboard - /);
  return m ? tidy(m[1]) : '';
}

/**
 * Forget the browser's session: the page is emptied first, so no request of the site brings a new session back.
 *
 * @param {object} world
 */
async function dropSession(world) {
  if (world.page.url() !== 'about:blank') await world.page.goto('about:blank').catch(() => {});
  await world.context.clearCookies();
}

/**
 * Fill and submit the login form with a login and a password. It asserts nothing.
 *
 * @param {object} world
 * @param {string} username
 * @param {string} password
 */
async function submitLogin(world, username, password) {
  const page = world.page;
  await open(world, '/user/login');
  await actOrExplain('fill in the login form for', username, async () => {
    const form = page.locator('form:has(#user_name):has(#password)').last();
    await form.locator('#user_name').waitFor({ state: 'visible', timeout: budget(world) });
    await form.locator('#user_name').fill(username);
    await form.locator('#password').fill(password);
    await form.getByRole('button', { name: /^\s*sign in\s*$/i }).first().click();
  }, 'The login form (#user_name, #password and its Sign In button) did not show at /user/login. A forge that signs in through another provider only has no such form, and a session that is already open is sent to its dashboard instead.');
  await smartSettle(page, 2000);
}

const sessions = new Map();

/**
 * Sign in with an account of the users registry and make sure the session is that account's. An account that is
 * already signed in is kept; an account that signed in earlier in the run gets its session back; otherwise the account
 * goes through the login form.
 *
 * @param {object} world
 * @param {string} handle
 */
async function signInAs(world, handle) {
  const user = resolveUser(world, handle);
  const key = siteRoot(world) + '|' + handle;
  if ((await currentUser(world)) === user.username) {
    if (world.page.url() === 'about:blank' || !world.page.url().startsWith(siteRoot(world))) await open(world, '/');
    return;
  }
  await dropSession(world);
  const saved = sessions.get(key);
  if (saved) {
    await world.context.addCookies(saved);
    if ((await currentUser(world)) === user.username) {
      await open(world, '/');
      return;
    }
    sessions.delete(key);
    await dropSession(world);
  }
  await submitLogin(world, user.username, user.password);
  const result = await waitForValue(() => currentUser(world), (login) => login === user.username, budget(world));
  if (!result.ok) {
    const error = tidy(await world.page.locator('.flash-error').first().innerText({ timeout: 1500 }).catch(() => ''));
    throw friendly({
      message: `Logging in as "${handle}" (login "${user.username}") did not work${error ? `: the site says "${error}"` : `; the page is ${world.page.url()}`}.`,
      hint: 'Check the login and the password of this account in worldParameters.users of cucumber.js, and that the account exists on the site and may log in.',
    });
  }
  sessions.set(key, await world.context.cookies());
}

// ---------------------------------------------------------------------------
// The forge's REST API, as the managing account
// ---------------------------------------------------------------------------

const managers = new Map();

/** The managing accounts' request contexts of a run, all of them, and their end. */
const managerContexts = {
  async dispose() {
    for (const ctx of managers.values()) await ctx.dispose().catch(() => {});
    managers.clear();
  },
};

/**
 * A request context of its own for the managing account (`worldParameters.manager`, a handle of the users registry),
 * for the test content a scenario makes and removes: the REST API with the account's login and password (HTTP Basic,
 * which the forge takes for an account without a second factor). It never touches the browser's session.
 *
 * @param {object} world
 * @returns {Promise<import('playwright').APIRequestContext>}
 */
async function managerContext(world) {
  const handle = (world.parameters && world.parameters.manager) || 'owner';
  const key = siteRoot(world) + '|' + handle;
  if (managers.has(key)) return managers.get(key);
  const user = resolveUser(world, handle);
  const ctx = await playwright.request.newContext({
    baseURL: siteRoot(world), ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: 'Basic ' + Buffer.from(`${user.username}:${user.password}`).toString('base64'), Accept: 'application/json' },
  });
  const me = await ctx.get('/api/v1/user', { failOnStatusCode: false });
  const login = me.status() === 200 ? String((await me.json()).login || '') : '';
  if (login !== user.username) {
    await ctx.dispose();
    throw friendly({
      message: `The managing account "${handle}" could not use the REST API of ${siteRoot(world)} for the test content (it answered ${me.status()}).`,
      hint: 'Check worldParameters.manager and the account in worldParameters.users of cucumber.js; an account with a second factor cannot use its password for the API.',
    });
  }
  managers.set(key, ctx);
  return ctx;
}

/**
 * One call of the REST API as the managing account: its status and its JSON.
 *
 * @param {object} world
 * @param {string} method
 * @param {string} path - a path under /api/v1
 * @param {object} [data]
 * @returns {Promise<{status: number, data: *}>}
 */
async function api(world, method, path, data) {
  const ctx = await managerContext(world);
  const r = await ctx.fetch('/api/v1' + path, {
    method,
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    data: data === undefined ? undefined : JSON.stringify(data),
    failOnStatusCode: false,
  });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status(), data: body };
}

/**
 * An answer of the API that is not a success, as a friendly error.
 *
 * @param {string} what
 * @param {{status: number, data: *}} r
 * @param {string} hint
 */
function apiFailure(what, r, hint) {
  const said = r.data && r.data.message ? ` (${r.data.message})` : '';
  return friendly({ message: `Could not ${what}: the site answered ${r.status}${said}.`, hint });
}

/**
 * A repository by owner/name, as the managing account sees it: { owner, name, path }. The step's repository, else the
 * one of cucumber.js.
 *
 * @param {object} world
 * @param {string} [which]
 */
async function findRepository(world, which) {
  const wanted = String(which || (world.parameters && world.parameters.repository) || '').trim().replace(/\.git$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(wanted)) {
    throw friendly({ message: `"${wanted}" is not a repository: name it owner/name.`, hint: 'The sample repository is owner/webship-site; worldParameters.repository of cucumber.js is the one steps use when they name none.' });
  }
  const r = await api(world, 'GET', `/repos/${wanted}`);
  if (r.status !== 200) throw apiFailure(`find the repository ${wanted}`, r, 'The managing account must be its owner or have access to it.');
  return { owner: r.data.owner.login, name: r.data.name, path: r.data.full_name };
}

/**
 * The issues of a repository whose title is the text, open or closed (pull requests left out). The list is read page
 * by page, not searched: the forge's search reads an index that takes a moment to learn a new issue.
 *
 * @param {object} world
 * @param {{path: string}} repo
 * @param {string} title
 * @returns {Promise<object[]>}
 */
async function findIssues(world, repo, title) {
  const found = [];
  for (let page = 1; page <= 20; page += 1) {
    const q = new URLSearchParams({ state: 'all', type: 'issues', limit: '50', page: String(page) });
    const r = await api(world, 'GET', `/repos/${repo.path}/issues?${q.toString()}`);
    if (r.status !== 200) throw apiFailure(`look for the issue "${title}"`, r, 'The managing account must see the repository\'s issues.');
    const items = r.data || [];
    found.push(...items.filter((i) => !i.pull_request && exactly(title).test(i.title)));
    if (items.length < 50) break;
  }
  return found;
}

/**
 * The one issue of a title in a repository (the step's, else the last one a scenario used).
 *
 * @param {object} world
 * @param {string} title
 * @param {string} [repoName]
 * @returns {Promise<object>}
 */
async function issueNamed(world, title, repoName) {
  const repo = await findRepository(world, repoName || (world.gitea && world.gitea.repository));
  const found = await findIssues(world, repo, title);
  if (!found.length) throw friendly({ message: `There is no issue "${title}" in ${repo.path}.`, hint: 'Make it first with Given there is an issue "…" in the repository "…".' });
  return Object.assign(found[0], { repository: repo.path });
}

/**
 * Remember an issue a scenario made, so it goes after the scenario.
 *
 * @param {object} world
 * @param {string} repoPath
 * @param {number|string} number
 */
function remember(world, repoPath, number) {
  world.gitea = world.gitea || {};
  world.gitea.made = world.gitea.made || new Set();
  world.gitea.made.add(`${repoPath}#${number}`);
}

/**
 * Remove an issue, as the managing account: the forge removes its comments and the time spent on it with it.
 *
 * @param {object} world
 * @param {string} repoPath
 * @param {number|string} number
 */
async function removeIssue(world, repoPath, number) {
  const r = await api(world, 'DELETE', `/repos/${repoPath}/issues/${number}`);
  if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw apiFailure(`remove the issue ${repoPath}#${number}`, r, 'The managing account must be allowed to delete the repository\'s issues (its owner or an administrator of it).');
}

/**
 * Make an issue as the managing account, with a milestone when one is named.
 *
 * @param {object} world
 * @param {{path: string}} repo
 * @param {string} title
 * @param {{milestone?: string}} [extra]
 * @returns {Promise<object>}
 */
async function makeIssue(world, repo, title, extra = {}) {
  const body = { title, body: 'Made by a test scenario; it goes after the scenario.' };
  if (extra.milestone) {
    const m = await api(world, 'GET', `/repos/${repo.path}/milestones?state=all&name=${encodeURIComponent(extra.milestone)}`);
    const found = ((m.data || [])).find((x) => exactly(extra.milestone).test(x.title));
    if (!found) throw friendly({ message: `There is no milestone "${extra.milestone}" in ${repo.path}.`, hint: 'The sample content has the milestone Sprint 1.' });
    body.milestone = found.id;
  }
  const r = await api(world, 'POST', `/repos/${repo.path}/issues`, body);
  if (r.status !== 201) throw apiFailure(`make the issue "${title}"`, r, 'The managing account must be allowed to open issues in the repository.');
  remember(world, repo.path, r.data.number);
  return r.data;
}

module.exports = {
  budget,
  escapeRegExp,
  exactly,
  tidy,
  actOrExplain,
  assertPresence,
  waitForValue,
  siteRoot,
  siteUrl,
  open,
  resolveUser,
  frontPage,
  currentUser,
  currentName,
  dropSession,
  submitLogin,
  signInAs,
  managerContext,
  managerContexts,
  api,
  apiFailure,
  findRepository,
  findIssues,
  issueNamed,
  remember,
  removeIssue,
  makeIssue,
};
