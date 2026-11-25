'use strict';

// Milestone step definitions: the milestones of a repository, and the issues of one milestone. A milestone is the
// forge's iteration: the tracker family's "current milestone" is the open one due first.

const { When, Then } = require('@cucumber/cucumber');
const { friendly } = require('webship-js/tests/step-definitions/webship');
const { budget, exactly, open, assertPresence, findRepository, api, apiFailure } = require('./gitea-helpers');

/** The repository a step names, else the last one a scenario used, else the one of cucumber.js. */
async function repositoryOf(world, which) {
  const repo = await findRepository(world, which || (world.gitea && world.gitea.repository));
  world.gitea = Object.assign(world.gitea || {}, { repository: repo.path });
  return repo;
}

/**
 * Open the milestones of a repository (its open milestones).
 *
 * Example #1: When I open the milestones of the repository "owner/webship-site"
 * Example #2: When we open the milestones of the repository "owner/webship-site"
 * Example #3: And I open the milestones of the repository "owner/webship-site"
 * Example #4: Given I open the milestones of the repository "owner/webship-site"
 * Example #5: When open the milestones of the repository "owner/webship-site"
 *
 */
When(/^(I |we )*open the milestones of the repository "([^"]*)"$/, async function (pronounCase, which) {
  const repo = await repositoryOf(this, which);
  await open(this, `/${repo.path}/milestones`);
});

/**
 * Assert that the milestones on screen list (or do not list) a milestone of this name.
 *
 * Example #1: Then the milestones should list "Sprint 1"
 * Example #2: Then the milestones should not list "Sprint 9"
 * Example #3: And the milestones should list "Sprint 1"
 * Example #4: But the milestones should not list "Release 0.1"
 * Example #5: Then the milestones should list "Sprint 1"
 *
 */
Then(/^the milestones should( not)? list "([^"]*)"$/, async function (notCase, name) {
  await assertPresence(this.page.locator('.milestone-list a[href*="/milestone/"]').filter({ hasText: exactly(name) }), notCase, {
    label: `the milestone "${name}"`,
    hint: notCase ? 'The page lists the open milestones: a closed one leaves it.' : 'The page lists the open milestones of the repository.',
    timeout: budget(this),
  });
});

/**
 * Open a milestone of a repository by its name: its page, with its issues.
 *
 * Example #1: When I open the milestone "Sprint 1" of the repository "owner/webship-site"
 * Example #2: When I open the milestone "Sprint 1"
 * Example #3: And we open the milestone "Sprint 1" of the repository "owner/webship-site"
 * Example #4: Given I open the milestone "Sprint 1"
 * Example #5: When open the milestone "Sprint 1" of the repository "owner/webship-site"
 *
 */
When(/^(I |we )*open the milestone "([^"]*)"(?: of the repository "([^"]*)")?$/, async function (pronounCase, name, which) {
  const repo = await repositoryOf(this, which);
  const r = await api(this, 'GET', `/repos/${repo.path}/milestones?state=all&limit=50`);
  if (r.status !== 200) throw apiFailure(`look for the milestone "${name}"`, r, 'The managing account must see the repository.');
  const found = (r.data || []).find((m) => exactly(name).test(m.title));
  if (!found) throw friendly({ message: `There is no milestone "${name}" in ${repo.path}.`, hint: 'The sample content has the milestone Sprint 1.' });
  await open(this, `/${repo.path}/milestone/${found.id}`);
});

/**
 * Assert that the milestone on screen lists (or does not list) an issue of this title among its open issues.
 *
 * Example #1: Then the milestone should list the issue "The greeting script says Helo instead of Hello"
 * Example #2: Then the milestone should not list the issue "The usage line spells greeting as greting"
 * Example #3: And the milestone should list the issue "Webship test sprint"
 * Example #4: But the milestone should not list the issue "Webship test elsewhere"
 * Example #5: Then the milestone should list the issue "Webship test sprint"
 *
 */
Then(/^the milestone should( not)? list the issue "([^"]*)"$/, async function (notCase, title) {
  if (!/\/milestone\/\d+/.test(this.page.url())) throw friendly({ message: `No milestone is open (the page is ${this.page.url()}).`, hint: 'Open one first with When I open the milestone "…".' });
  await assertPresence(this.page.locator('a[href*="/issues/"]').filter({ hasText: exactly(title) }), notCase, {
    label: `the issue "${title}" in the milestone`,
    hint: notCase ? 'A milestone lists its open issues.' : 'A milestone lists its open issues; put an issue in it with Given there is an issue "…" in the milestone "…".',
    timeout: budget(this),
  });
});
