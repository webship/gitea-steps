'use strict';

// Issue step definitions: the test content a scenario makes and removes (through the forge's REST API, as the
// managing account), the issue list, one issue and what a person does on it through its page (a comment, closing and
// reopening it, the time spent on it, its assignee), what its sidebar shows (its milestone), a new issue made through
// the form, and what an account may not do (a reader's close button, assignee and time tracker).
//
// What a scenario makes goes after it: the issues a Given step made and the ones a scenario created through the form
// are removed, with their comments and the time spent on them, as the managing account, so a run leaves the site as it
// found it. Name test content "Webship test …": `cmd-tools-gitea-cli.sh <site> --tidy` removes what a stopped run left.
//
// Gitea 1.27 and Forgejo 17 draw the issue sidebar differently (a combo list in Gitea, the older dropdowns in Forgejo);
// each control below is looked for in both shapes. A milestone is set through the API, never the sidebar: Forgejo's own
// script logs errors after a milestone change on the page.

const { Given, When, Then, After, AfterAll } = require('@cucumber/cucumber');
const { smartSettle, friendly } = require('webship-js/tests/step-definitions/webship');
const {
  budget,
  escapeRegExp,
  exactly,
  tidy,
  open,
  actOrExplain,
  assertPresence,
  waitForValue,
  findRepository,
  findIssues,
  issueNamed,
  remember,
  removeIssue,
  makeIssue,
  managerContexts,
} = require('./gitea-helpers');

/** The repository a step names, else the last one a scenario used, else the one of cucumber.js. */
async function repositoryOf(world, which) {
  const repo = await findRepository(world, which || (world.gitea && world.gitea.repository));
  world.gitea = Object.assign(world.gitea || {}, { repository: repo.path });
  return repo;
}

/** The issue page on screen: its repository and number, from the address, or a friendly error. */
function openIssue(world) {
  const m = world.page.url().match(/\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!m) throw friendly({ message: `No issue is open (the page is ${world.page.url()}).`, hint: 'Open one first with When I open the issue "…".' });
  return { repository: m[1], number: m[2] };
}

/** What the open issue's state label says: "Open" or "Closed". */
async function stateOf(world) {
  return tidy(await world.page.locator('.issue-state-label').first().innerText({ timeout: 2000 }).catch(() => ''));
}

/** The sidebar's assignee control: Gitea's combo dropdown, or Forgejo's dropdown. */
function assigneeDropdown(page) {
  return page.locator('.issue-sidebar-combo[data-update-url*="/issues/assignee"] .ui.dropdown, .select-assignees-modify.dropdown').first();
}

/** The logins (and full names) the sidebar shows as the issue's assignees. */
async function assigneesShown(world) {
  return world.page.evaluate(() => {
    const out = [];
    const combo = document.querySelector('.issue-sidebar-combo[data-update-url*="/issues/assignee"] .ui.list');
    const list = combo || document.querySelector('.ui.assignees.list .selected');
    if (!list) return out;
    for (const item of list.querySelectorAll('a.item, .item a, .item')) {
      if (item.classList.contains('empty-list') || item.closest('.tw-hidden, .no-select')) continue;
      const text = item.textContent.replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
    }
    return [...new Set(out)];
  });
}

/** The milestone the sidebar shows for the issue, or ''. */
async function milestoneShown(world) {
  return world.page.evaluate(() => {
    const combo = document.querySelector('.issue-sidebar-combo[data-update-url*="/issues/milestone"] .ui.list');
    const list = combo || document.querySelector('#selected-milestone .selected, .ui.select-milestone.list .selected');
    if (!list) return '';
    const items = [...list.querySelectorAll('a.item, .item a, .item, a')].filter((e) => !e.classList.contains('empty-list') && !e.closest('.tw-hidden, .no-select'));
    return items.length ? items[0].textContent.replace(/\s+/g, ' ').trim() : '';
  });
}

/** "Total Time Spent: 30 minutes" of the sidebar (Forgejo: "Total time spent"), as "30 minutes"; '' when none. */
async function timeSpentShown(world) {
  return world.page.evaluate(() => {
    const side = document.querySelector('.issue-content-right') || document.body;
    for (const e of side.querySelectorAll('*')) {
      if (e.children.length) continue;
      const m = e.textContent.replace(/\s+/g, ' ').trim().match(/^Total time spent:\s*(.+)$/i);
      if (m) return m[1].trim();
    }
    return '';
  });
}

// ---------------------------------------------------------------------------
// Test content
// ---------------------------------------------------------------------------

/**
 * Make sure there is an issue of this title in a repository (made through the API as the managing account; one of the
 * same title is removed first, so a scenario starts from a known issue). It goes after the scenario. With "in the
 * milestone …" it is in that milestone of the repository from the start.
 *
 * Example #1: Given there is an issue "Webship test comment" in the repository "owner/webship-site"
 * Example #2: Given there is an issue "Webship test close"
 * Example #3: And there is an issue "Webship test time" in the repository "owner/webship-site"
 * Example #4: Given there is an issue "Webship test sprint" in the milestone "Sprint 1"
 * Example #5: Given there is an issue "Webship test assign" in the milestone "Sprint 1" of the repository "owner/webship-site"
 *
 */
Given(/^there is an issue "([^"]*)"(?: in the milestone "([^"]*)")?(?: (?:in|of) the repository "([^"]*)")?$/, async function (title, milestone, which) {
  const repo = await repositoryOf(this, which);
  for (const old of await findIssues(this, repo, title)) await removeIssue(this, repo.path, old.number);
  await makeIssue(this, repo, title, { milestone });
});

/**
 * Make sure there is no issue of this title in a repository (any is removed through the API, with its comments and
 * time).
 *
 * Example #1: Given there is no issue "Webship test new" in the repository "owner/webship-site"
 * Example #2: Given there is no issue "Webship test form"
 * Example #3: And there is no issue "Webship test new" in the repository "owner/webship-site"
 * Example #4: Given there is no issue "Webship test made by hand"
 * Example #5: But there is no issue "Webship test new"
 *
 */
Given(/^there is no issue "([^"]*)"(?: in the repository "([^"]*)")?$/, async function (title, which) {
  const repo = await repositoryOf(this, which);
  for (const old of await findIssues(this, repo, title)) await removeIssue(this, repo.path, old.number);
});

// ---------------------------------------------------------------------------
// The issue list
// ---------------------------------------------------------------------------

/**
 * Open the issues of a repository (its list of open issues).
 *
 * Example #1: When I open the issues of the repository "owner/webship-site"
 * Example #2: When we open the issues of the repository "owner/webship-site"
 * Example #3: And I open the issues of the repository "owner/webship-site"
 * Example #4: Given I open the issues of the repository "owner/webship-site"
 * Example #5: When open the issues of the repository "owner/webship-site"
 *
 */
When(/^(I |we )*open the issues of the repository "([^"]*)"$/, async function (pronounCase, which) {
  const repo = await repositoryOf(this, which);
  await open(this, `/${repo.path}/issues`);
});

/**
 * Assert that the issue list on screen shows (or does not show) an issue of this title.
 *
 * Example #1: Then the issue list should show "The greeting script says Helo instead of Hello"
 * Example #2: Then the issue list should not show "Webship test closed"
 * Example #3: And the issue list should show "Webship test list"
 * Example #4: But the issue list should not show "Webship test gone"
 * Example #5: Then the issue list should show "The usage line spells greeting as greting"
 *
 */
Then(/^the issue list should( not)? show "([^"]*)"$/, async function (notCase, title) {
  const link = this.page.locator('a[href*="/issues/"]').filter({ hasText: exactly(title) });
  await assertPresence(link, notCase, {
    label: `the issue "${title}" in the list`,
    hint: notCase ? 'The list shows the open issues: a closed one leaves it.' : 'The list shows the open issues the session may see; check the title and that the issue is open.',
    timeout: budget(this),
  });
});

/**
 * Make an issue through the form of a new issue, as the session's account (its title, and a description). It goes
 * after the scenario.
 *
 * Example #1: When I create an issue "Webship test form" in the repository "owner/webship-site"
 * Example #2: When we create an issue "Webship test form"
 * Example #3: And I create an issue "Webship test made by hand" in the repository "owner/webship-site"
 * Example #4: When I create an issue "Webship test new"
 * Example #5: When create an issue "Webship test form"
 *
 */
When(/^(I |we )*create an issue "([^"]*)"(?: in the repository "([^"]*)")?$/, async function (pronounCase, title, which) {
  const repo = await repositoryOf(this, which);
  const page = this.page;
  await open(this, `/${repo.path}/issues/new`);
  await actOrExplain('create the issue', title, async () => {
    const form = page.locator('form:has(#issue_title)').first();
    await form.locator('#issue_title').fill(title);
    await form.locator('textarea[name="content"]').first().fill('Made by a test scenario through the form; it goes after the scenario.');
    await form.getByRole('button', { name: /^\s*create issue\s*$/i }).first().click();
    await page.waitForURL(/\/issues\/\d+(?:[?#].*)?$/, { timeout: budget(this) });
  }, 'The form of a new issue (#issue_title and its Create Issue button) is at /owner/name/issues/new for an account that may open issues.');
  const made = openIssue(this);
  remember(this, made.repository, made.number);
  await smartSettle(page, 1000);
});

// ---------------------------------------------------------------------------
// One issue
// ---------------------------------------------------------------------------

/**
 * Open an issue by its title, in the repository the scenario uses.
 *
 * Example #1: When I open the issue "The greeting script says Helo instead of Hello"
 * Example #2: When we open the issue "Webship test comment"
 * Example #3: And I open the issue "Webship test close"
 * Example #4: Given I open the issue "Webship test time"
 * Example #5: When open the issue "An issue opened by someone outside the project"
 *
 */
When(/^(I |we )*open the issue "([^"]*)"$/, async function (pronounCase, title) {
  const issue = await issueNamed(this, title);
  this.gitea = Object.assign(this.gitea || {}, { repository: issue.repository });
  await open(this, `/${issue.repository}/issues/${issue.number}`);
});

/**
 * Add a comment to the open issue through its comment box, and wait until the issue shows it.
 *
 * Example #1: When I add the comment "Checked on the test site" to the issue
 * Example #2: When we add the comment "Seen" to the issue
 * Example #3: And I add the comment "The fix is on a branch" to the issue
 * Example #4: Then I add the comment "Done" to the issue
 * Example #5: When add the comment "Checked" to the issue
 *
 */
When(/^(I |we )*add the comment "([^"]*)" to the issue$/, async function (pronounCase, text) {
  openIssue(this);
  const page = this.page;
  await actOrExplain('add the comment', text, async () => {
    const form = page.locator('#comment-form');
    await form.locator('textarea[name="content"]').first().fill(text);
    await form.getByRole('button', { name: /^\s*comment\s*$/i }).first().click();
  }, 'The comment box (#comment-form, its text area and its Comment button) shows for an account that may comment.');
  await assertPresence(page.locator('.timeline-item.comment[id^="issuecomment-"] .render-content').filter({ hasText: text }), null, {
    label: `the comment "${text}"`, hint: 'The forge reloads the issue with the new comment in its timeline.', timeout: budget(this),
  });
});

/**
 * Assert that the open issue shows a comment that holds the text, written by that account when one is named (its
 * login, or the full name of a handle of the users registry).
 *
 * Example #1: Then the issue should show the comment "Checked on the test site"
 * Example #2: Then the issue should show the comment "Checked on the test site" by "member"
 * Example #3: And the issue should show the comment "The script is in the repository" by "owner"
 * Example #4: But the issue should show the comment "Seen"
 * Example #5: Then the issue should show the comment "Done" by "Member Test"
 *
 */
Then(/^the issue should show the comment "([^"]*)"(?: by "([^"]*)")?$/, async function (text, who) {
  openIssue(this);
  const comment = this.page.locator('.timeline-item.comment[id^="issuecomment-"]').filter({ has: this.page.locator('.render-content').filter({ hasText: text }) });
  await assertPresence(comment, null, { label: `the comment "${text}"`, hint: 'Comments are in the issue\'s timeline, under its description.', timeout: budget(this) });
  if (!who) return;
  const users = (this.parameters && this.parameters.users) || {};
  const entry = Object.values(users).find((u) => u && (u.name === who || u.username === who));
  const login = entry ? entry.username : who;
  const authors = (await comment.locator('.comment-header-left a.author, .comment-header-left a.tw-font-semibold').allInnerTexts()).map(tidy);
  if (!authors.includes(login)) {
    throw friendly({ message: `Expected the comment "${text}" to be by "${who}" (${login}), but it is by ${authors.join(', ') || 'nobody the page names'}.`, hint: 'The forge names a comment\'s author by login; a handle of the users registry is read as its login.' });
  }
});

/**
 * Close or reopen the open issue with its button (Gitea's "Close Issue" and "Reopen Issue", Forgejo's "Close issue"
 * and "Reopen"), and wait until its state says so.
 *
 * Example #1: When I close the issue
 * Example #2: When I reopen the issue
 * Example #3: And we close the issue
 * Example #4: Then I reopen the issue
 * Example #5: When close the issue
 *
 */
When(/^(I |we )*(close|reopen) the issue$/, async function (pronounCase, action) {
  openIssue(this);
  const want = action === 'close' ? 'Closed' : 'Open';
  const button = this.page.locator('#status-button').filter({ hasText: action === 'close' ? /^\s*close/i : /^\s*reopen/i }).first();
  await actOrExplain(`${action} the issue`, this.page.url(), () => button.click({ timeout: budget(this) }),
    action === 'close' ? 'An open issue has a Close button for its author and those with write access.' : 'A closed issue has a Reopen button for its author and those with write access.');
  const result = await waitForValue(() => stateOf(this), (s) => exactly(want).test(s), budget(this));
  if (!result.ok) throw friendly({ message: `Expected the issue to be ${want.toLowerCase()} after "${action}", but it says "${result.value || 'nothing'}".`, hint: 'The forge reloads the issue with its new state.' });
});

/**
 * Assert the state of the open issue: "open" or "closed".
 *
 * Example #1: Then the issue should be "open"
 * Example #2: Then the issue should be "closed"
 * Example #3: And the issue should be "open"
 * Example #4: But the issue should be "closed"
 * Example #5: Then the issue should be "Open"
 *
 */
Then(/^the issue should be "(open|closed|Open|Closed)"$/, async function (state) {
  openIssue(this);
  const result = await waitForValue(() => stateOf(this), (s) => exactly(state).test(s), budget(this));
  if (!result.ok) throw friendly({ message: `Expected the issue to be ${state}, but it says "${result.value || 'nothing'}".`, hint: 'The state label is under the issue\'s title.' });
});

/**
 * Log time spent on the open issue through its time tracker ("Add Time": hours and minutes), and wait until the issue
 * counts it. "0.5" hours are 30 minutes.
 *
 * Example #1: When I log "0.5" hours on the issue
 * Example #2: When we log "1" hours on the issue
 * Example #3: And I log "1.25" hours on the issue
 * Example #4: Then I log "0.25" hours on the issue
 * Example #5: When log "2" hours on the issue
 *
 */
When(/^(I |we )*log "([0-9]+(?:\.[0-9]+)?)" hours on the issue$/, async function (pronounCase, amount) {
  openIssue(this);
  const total = Math.round(Number(amount) * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const page = this.page;
  const before = await timeSpentShown(this);
  await actOrExplain('log time on the issue', `${amount} hours`, async () => {
    await page.locator('button.issue-add-time').first().click({ timeout: budget(this) });
    const modal = page.locator('.ui.modal.visible:has(input[name="hours"])').first();
    await modal.waitFor({ state: 'visible', timeout: budget(this) });
    await modal.locator('input[name="hours"]').fill(String(hours));
    await modal.locator('input[name="minutes"]').fill(String(minutes));
    await modal.locator('.primary.button').first().click();
  }, 'The time tracker ("Add Time") shows for those with write access when time tracking is on in the repository.');
  const result = await waitForValue(() => timeSpentShown(this), (t) => t !== '' && t !== before, budget(this));
  if (!result.ok) throw friendly({ message: `The time logged did not show: the issue still says "${result.value || 'no time spent'}".`, hint: 'The forge reloads the issue with "Total Time Spent" in its sidebar.' });
});

/**
 * Assert the total time spent on the open issue, as its sidebar says it ("30 minutes", "1 hour 15 minutes").
 *
 * Example #1: Then the time spent on the issue should be "30 minutes"
 * Example #2: Then the time spent on the issue should be "1 hour"
 * Example #3: And the time spent on the issue should be "1 hour 15 minutes"
 * Example #4: But the time spent on the issue should be "15 minutes"
 * Example #5: Then the time spent on the issue should be "2 hours"
 *
 */
Then(/^the time spent on the issue should be "([^"]*)"$/, async function (expected) {
  openIssue(this);
  const result = await waitForValue(() => timeSpentShown(this), (t) => exactly(expected).test(t), budget(this));
  if (!result.ok) throw friendly({ message: `Expected the time spent to be "${expected}", but the issue says "${result.value || 'no time spent'}".`, hint: 'The sidebar says "Total Time Spent: …" once time is logged.' });
});

/**
 * Assign the open issue to an account through its sidebar (its login, as the list of assignees shows it), and wait
 * until the sidebar shows it.
 *
 * Example #1: When I assign the issue to "member"
 * Example #2: When we assign the issue to "owner"
 * Example #3: And I assign the issue to "member"
 * Example #4: Then I assign the issue to "owner"
 * Example #5: When assign the issue to "member"
 *
 */
When(/^(I |we )*assign the issue to "([^"]*)"$/, async function (pronounCase, login) {
  openIssue(this);
  const page = this.page;
  const dropdown = assigneeDropdown(page);
  await actOrExplain('assign the issue to', login, async () => {
    await dropdown.click({ timeout: budget(this) });
    await dropdown.locator('.menu .item').filter({ hasText: new RegExp('^\\s*' + escapeRegExp(login) + '(\\s|\\(|$)', 'i') }).first().click({ timeout: budget(this) });
    // The choice is sent when the menu closes.
    await page.locator('#issue-title-display').first().click();
  }, 'The Assignees control of the sidebar lists the accounts with write access; a reader sees it disabled.');
  const result = await waitForValue(() => assigneesShown(this), (list) => list.some((a) => a.split(/\s/)[0] === login), budget(this));
  if (!result.ok) throw friendly({ message: `The issue was not assigned to "${login}": the sidebar shows ${(result.value || []).join(', ') || 'no assignee'}.`, hint: 'Only an account with write access to the repository may be assigned.' });
});

/**
 * Assert that the open issue is assigned to an account: its login ("member") or its full name ("Member Test").
 *
 * Example #1: Then the issue should be assigned to "member"
 * Example #2: Then the issue should be assigned to "Member Test"
 * Example #3: And the issue should be assigned to "owner"
 * Example #4: But the issue should be assigned to "member"
 * Example #5: Then the issue should be assigned to "Owner Test"
 *
 */
Then(/^the issue should be assigned to "([^"]*)"$/, async function (who) {
  openIssue(this);
  const users = (this.parameters && this.parameters.users) || {};
  const entry = Object.values(users).find((u) => u && (u.name === who || u.username === who));
  const login = entry ? entry.username : who;
  const result = await waitForValue(() => assigneesShown(this), (list) => list.some((a) => a.split(/\s/)[0] === login || a.includes(`(${who})`)), budget(this));
  if (!result.ok) throw friendly({ message: `Expected the issue to be assigned to "${who}", but the sidebar shows ${(result.value || []).join(', ') || 'no assignee'}.`, hint: 'The Assignees of the sidebar name each by login (Gitea adds the full name).' });
});

/**
 * Assert the milestone the open issue is in, as its sidebar shows it.
 *
 * Example #1: Then the milestone of the issue should be "Sprint 1"
 * Example #2: Then the milestone of the issue should be "Sprint 2"
 * Example #3: And the milestone of the issue should be "Sprint 1"
 * Example #4: But the milestone of the issue should be "Sprint 1"
 * Example #5: Then the milestone of the issue should be "Release 1.0"
 *
 */
Then(/^the milestone of the issue should be "([^"]*)"$/, async function (name) {
  openIssue(this);
  const result = await waitForValue(() => milestoneShown(this), (m) => exactly(name).test(m), budget(this));
  if (!result.ok) throw friendly({ message: `Expected the issue to be in the milestone "${name}", but the sidebar shows ${result.value ? `"${result.value}"` : 'none'}.`, hint: 'Put an issue in a milestone with Given there is an issue "…" in the milestone "…".' });
});

// ---------------------------------------------------------------------------
// What an account may not do
// ---------------------------------------------------------------------------

/**
 * Assert that the open issue offers the session no close button (a reader on someone else's issue).
 *
 * Example #1: Then I should not be able to close the issue
 * Example #2: Then we should not be able to close the issue
 * Example #3: And I should not be able to close the issue
 * Example #4: But I should not be able to close the issue
 * Example #5: Then should not be able to close the issue
 *
 */
Then(/^(I |we )*should not be able to close the issue$/, async function (pronounCase) {
  openIssue(this);
  await assertPresence(this.page.locator('.timeline-item.comment[id^="issue-"], .issue-title').first(), null, { label: 'the issue', hint: 'Open it first.', timeout: budget(this) });
  if (await this.page.locator('#status-button').count()) {
    throw friendly({ message: 'Expected no close button for this session, but the issue has one.', hint: 'Its author and those with write access may close an issue; a reader may not close someone else\'s.' });
  }
});

/**
 * Assert that the open issue does not let the session change its assignees (the control is disabled, or not there).
 *
 * Example #1: Then I should not be able to assign the issue
 * Example #2: Then we should not be able to assign the issue
 * Example #3: And I should not be able to assign the issue
 * Example #4: But I should not be able to assign the issue
 * Example #5: Then should not be able to assign the issue
 *
 */
Then(/^(I |we )*should not be able to assign the issue$/, async function (pronounCase) {
  openIssue(this);
  const dropdown = assigneeDropdown(this.page);
  await this.page.locator('.issue-content-right').first().waitFor({ state: 'visible', timeout: budget(this) });
  if ((await dropdown.count()) && !(await dropdown.evaluate((e) => e.classList.contains('disabled')))) {
    throw friendly({ message: 'Expected the Assignees control to be closed to this session, but it may change them.', hint: 'Those with write access may assign an issue; a reader may not.' });
  }
});

/**
 * Assert that the open issue offers the session no time tracker (no "Add Time").
 *
 * Example #1: Then I should not be able to log time on the issue
 * Example #2: Then we should not be able to log time on the issue
 * Example #3: And I should not be able to log time on the issue
 * Example #4: But I should not be able to log time on the issue
 * Example #5: Then should not be able to log time on the issue
 *
 */
Then(/^(I |we )*should not be able to log time on the issue$/, async function (pronounCase) {
  openIssue(this);
  await this.page.locator('.issue-content-right').first().waitFor({ state: 'visible', timeout: budget(this) });
  if (await this.page.locator('button.issue-add-time').count()) {
    throw friendly({ message: 'Expected no time tracker for this session, but the issue has one.', hint: 'Those with write access may log time on an issue; a reader may not.' });
  }
});

// ---------------------------------------------------------------------------
// After a scenario: what it made goes
// ---------------------------------------------------------------------------

After(async function () {
  const made = (this.gitea && this.gitea.made) || new Set();
  for (const key of made) {
    const [repository, number] = key.split('#');
    try { await removeIssue(this, repository, number); } catch (e) { console.warn(`  could not remove the issue ${key} a scenario made: ${e.message}`); }
  }
  if (this.gitea) this.gitea.made = new Set();
});

AfterAll(async function () {
  await managerContexts.dispose();
});
