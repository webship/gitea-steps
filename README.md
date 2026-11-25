<p align="center"><img src="https://raw.githubusercontent.com/webship/gitea-steps/2.0.x/assets/gitea.svg" alt="Gitea logo" width="96">&nbsp;&nbsp;&nbsp;<img src="https://raw.githubusercontent.com/webship/gitea-steps/2.0.x/assets/forgejo.svg" alt="Forgejo logo" width="96"></p>

# gitea-steps

[![Test](https://github.com/webship/gitea-steps/actions/workflows/test.yml/badge.svg)](https://github.com/webship/gitea-steps/actions/workflows/test.yml)

Cucumber step definitions for testing **Gitea and Forgejo**, the open-source self-hosted Git forges, with
[webship-js](https://webship.co/docs/webship-js/2.0.x), a BDD browser automation harness built on Playwright and
Cucumber-js. One pack serves both: Forgejo is a fork of Gitea that keeps its API and its addresses, and where the two
draw a control differently (Forgejo 17 is built on Gitea 1.22, Gitea 1.27 has a newer issue sidebar) the steps look
for either. CI runs every step on both. The pack covers a repository's issues:

- **logging in and out**: an account of the users registry by its handle, the login form, a refused login, who the
  session is, logging out;
- **a repository**: opened by owner/name, and refused to an account with no access to it;
- **the issue list** of a repository, and **one issue**: a comment, closing and reopening it, the time spent on it,
  its assignee, and the milestone it is in;
- **a new issue** made through the form;
- **the milestones**: the open milestones of a repository, and the issues one holds;
- **what an account may not do**: a reader's close button, assignee and time tracker.

The steps make and remove their test content through the forge's own REST API, as a managing account (the
repository's owner): an issue a scenario makes goes after it, with its comments and the time spent on it, so a run
leaves the site as it found it.

No step phrase names the platform: a scenario reads `When I add the comment "…" to the issue` and
`Then the milestone should list the issue "…"`.

CI builds a real site with [DDEV](https://ddev.com) on the runner, Gitea and Forgejo in turn (the product's own image
on the project's own PostgreSQL, the accounts of the suite, the sample content), on Node.js 24 and 26. It runs the
whole suite against it twice on every push and pull request, checks after each run that the site holds what it held
before, then runs the assertions that must fail; see [The test site](#the-test-site) and
[`.github/workflows/test.yml`](.github/workflows/test.yml).

## Logging in first

Every scenario starts by logging in, so these are the steps to know first:

| Step | What it does |
| --- | --- |
| `Given I am a logged in user with the "member" user` | Logs in as an account of the users registry, by its handle. The first time in a run through the login form, then its session is put back |
| `When I log in with the "member" user` | Fills and submits the login form with the account's login and password, and asserts nothing: for scenarios about the login itself |
| `When I log in as "member" with the password "wrong"` | The same with a login and a password as typed |
| `Given I am not logged in` | The browser forgets its session |
| `When I log out` | Logs out through the account menu (Gitea's "Sign Out", Forgejo's "Sign out"), and waits until the session is a visitor's |
| `Then I should be logged in as "member"` | The session is the account's: its login, or its full name as the forge shows it (`"Member Test"`) |
| `Then I should not be logged in` | The session is a visitor's |
| `Then the login should be refused with "Username or password is incorrect."` | The login form refused the last login with that message |

```gherkin
Scenario: An account logs in through the form and out again
  Given I am not logged in
  When I log in with the "member" user
  Then I should be logged in as "Member Test"
  When I log out
  Then I should not be logged in
```

## From nothing to a green run

What the machine needs: Docker, [DDEV](https://ddev.com), git, python3, and Node.js 24 or later with npm. The forge and
its database run in DDEV's containers.

**1. The site.** The pack's own build script (the one CI runs) makes the site in a DDEV project: Gitea 1.27.3
(`gitea/gitea`), or Forgejo 17.0.2 with `PRODUCT=forgejo` (`codeberg.org/forgejo/forgejo`; `RELEASE` for another
release), on PostgreSQL 17, the four accounts of [Test users](#test-users), and the sample content (see
[The test site](#the-test-site)). It takes about a minute once the image is pulled (about 200 MB).

```bash
git clone https://github.com/webship/gitea-steps.git
SITE_DIR="$PWD/gitea-site" gitea-steps/.github/scripts/build-ddev-site.sh
SITE_DIR="$PWD/forgejo-site" PRODUCT=forgejo gitea-steps/.github/scripts/build-ddev-site.sh   # or Forgejo
```

The site answers at `https://giteasteps.ddev.site` (one at a time: both builds use that name). In the
[Webship Workspace](https://github.com/webship/workspace), its Gitea plugin builds the same site in a sites folder,
Gitea or Forgejo, on DDEV or on Docker Compose, and wires this pack into the testing setup of the site:

```bash
bash core/scripts/plugins.sh --require gitea --with-needs
bash core/scripts/plugins.sh --activate gitea --with-needs
bash core/scripts/plugins.sh --install gitea
bash dev/cmd-gitea-project.sh gtsite --install --add-users --sample-content                     # Gitea
bash dev/cmd-gitea-project.sh fjsite --product forgejo --install --add-users --sample-content   # Forgejo
bash dev/cmd-tools-testing.sh gtsite --run
```

**2. A test project.**

```bash
mkdir forge-tests && cd forge-tests
npm init -y
npm install --save-dev webship-js @webship-js/gitea-steps
npx init-webship-js
```

**3. `cucumber.js`.** Add the pack's step definitions after webship-js's own, and give the world its parameters:

```javascript
require: [
  'node_modules/webship-js/tests/step-definitions/**/*.js',
  'node_modules/@webship-js/gitea-steps/tests/step-definitions/**/*.js',
],
tags: process.env.CUCUMBER_TAGS || 'not @wip and not @must-fail',
worldParameters: {
  launchUrl: process.env.LAUNCH_URL || 'https://giteasteps.ddev.site',
  // The account that makes and removes test content through the forge's REST API: the repositories' owner.
  manager: process.env.MANAGER || 'owner',
  // The repository a step works in when it names none (owner/name).
  repository: process.env.REPOSITORY || 'owner/webship-site',
  users: {
    owner: { username: process.env.GITEA_OWNER_USER || 'owner', password: process.env.GITEA_OWNER_PASSWORD, name: 'Owner Test' },
    member: { username: process.env.GITEA_MEMBER_USER || 'member', password: process.env.GITEA_MEMBER_PASSWORD, name: 'Member Test' },
    reader: { username: process.env.GITEA_READER_USER || 'reader', password: process.env.GITEA_READER_PASSWORD, name: 'Reader Test' },
    stranger: { username: process.env.GITEA_STRANGER_USER || 'stranger', password: process.env.GITEA_STRANGER_PASSWORD, name: 'Stranger Test' },
  },
  // … webship-js's own parameters (minWaitTime, screenshot, javascript …)
},
```

This repository's own [`cucumber.js`](cucumber.js) is a whole example.

**4. Run.**

```bash
npx cucumber-js                                      # every feature
npx cucumber-js tests/features/issues.feature        # one feature
CUCUMBER_TAGS=@milestones npx cucumber-js            # one tag
```

## Steps

### Repositories

| Step | What it does |
| --- | --- |
| `When I open the repository "owner/webship-site"` | Opens the repository's front page |
| `Then I should be refused the repository "owner/webship-site"` | The session may not open the repository: the forge answers 404, "…not authorized to view it" (`@js-off`) |

### Test content

| Step | What it does |
| --- | --- |
| `Given there is an issue "Webship test …" in the repository "owner/webship-site"` | Makes it through the REST API as the managing account (one of the title left by a stopped run goes first). It goes after the scenario |
| `Given there is an issue "Webship test …" in the milestone "Sprint 1"` | The same, in that milestone of the repository from the start (`… of the repository "…"` names the repository) |
| `Given there is no issue "Webship test …" in the repository "owner/webship-site"` | Removes any of the title, with its comments and its time |

The repository part is optional: the last repository the scenario used, else `worldParameters.repository`.

### The issue list

| Step | What it does |
| --- | --- |
| `When I open the issues of the repository "owner/webship-site"` | The repository's list of open issues |
| `Then the issue list should show "…"` / `should not show "…"` | An issue of the title is (not) in the list on screen |
| `When I create an issue "Webship test …" in the repository "owner/webship-site"` | Through the form of a new issue, created. It goes after the scenario |

### One issue

| Step | What it does |
| --- | --- |
| `When I open the issue "…"` | Opens it by its title |
| `When I add the comment "…" to the issue` | Through its comment box, and waits until its timeline shows it |
| `Then the issue should show the comment "…"` (`… by "member"`) | The timeline shows the comment, written by that account when one is named (its login, or a handle's full name) |
| `When I close the issue` / `When I reopen the issue` | With its button, and waits until its state says so |
| `Then the issue should be "open"` / `"closed"` | The state it shows |
| `When I log "0.5" hours on the issue` | Through its time tracker ("Add Time": hours and minutes) |
| `Then the time spent on the issue should be "30 minutes"` | The total its sidebar shows ("Total Time Spent") |
| `When I assign the issue to "member"` | Through its sidebar: an account with write access, by login |
| `Then the issue should be assigned to "member"` | An assignee its sidebar shows: a login, or a full name (`"Member Test"`) |
| `Then the milestone of the issue should be "Sprint 1"` | The milestone its sidebar shows |

### What an account may not do

| Step | What it does |
| --- | --- |
| `Then I should not be able to close the issue` | It has no close button for the session (a reader, on someone else's issue) |
| `Then I should not be able to assign the issue` | Its Assignees control is disabled for the session |
| `Then I should not be able to log time on the issue` | It has no time tracker for the session |

### Milestones

| Step | What it does |
| --- | --- |
| `When I open the milestones of the repository "owner/webship-site"` | The repository's open milestones |
| `Then the milestones should list "Sprint 1"` / `should not list "…"` | A milestone of the name is (not) on the page |
| `When I open the milestone "Sprint 1" of the repository "owner/webship-site"` | The milestone's own page, with its open issues |
| `Then the milestone should list the issue "…"` / `should not list the issue "…"` | What it holds |

Every step carries five example phrasings in its JSDoc, and `npm run test:examples` checks that each one matches its
own step only.

## Rules of a suite

- Log in by a handle of the users registry; never write a password into a feature.
- Never create or delete an account in a suite: accounts are configuration, made by the build of the site.
- Change only what the scenario made: a comment, the time, the state and an assignee go on an issue of
  `Given there is an issue "…"`, which goes after the scenario with all of it. A comment stays in the timeline.
- Put an issue into a milestone through `Given there is an issue "…" in the milestone "…"`: Forgejo's own page script
  logs errors after a milestone is changed on the page.
- Name test content "Webship test …". A run that was stopped half way leaves its issues; the Workspace's
  `cmd-tools-gitea-cli.sh <site> --tidy` removes them, or delete them as the managing account.
- A refusal the forge answers with an error status (a repository an account may not see) makes the browser log a
  failed request: give those scenarios `@js-off`. A refused login answers 200 and needs none.

## Test users

The accounts the features log in as, each with the password `dD.123123ddd`:

| Handle | Login | Name | To the private repository owner/webship-site |
| --- | --- | --- | --- |
| `owner` | `owner` | Owner Test | Its owner (the managing account) |
| `member` | `member` | Member Test | A collaborator with write access |
| `reader` | `reader` | Reader Test | A collaborator with read access |
| `stranger` | `stranger` | Stranger Test | No access |

## The test site

`.github/scripts/build-ddev-site.sh` builds it, and `COUNTS_ONLY=1` makes it print what the site holds (issues, open
issues, assigned issues, comments, tracked times, milestones, labels, collaborators, users): CI compares them before
and after each run. The sample content, in the private repository owner/webship-site:

- `greeting.sh`, a script that greets, with two typos;
- "The greeting script says Helo instead of Hello": opened by the owner, assigned to member, in the milestone
  "Sprint 1" (due in eleven days), labelled bug, with a comment;
- "The usage line spells greeting as greting": opened by the member;
- "An issue opened by someone outside the project": opened by the reader, who may only read.

The features read them and never change them.

## The assertions that must fail

`tests/must-fail/` holds scenarios that assert something that is not true on the test site; `npm run test:must-fail`
runs them and checks that each fails at its last step with the message its description announces, and a hint. A step
that cannot fail proves nothing.

## Logos

The logos name the platforms the pack tests, as [Simple Icons](https://simpleicons.org) 16.37.0 ships them, in the
colours the set lists:

- `assets/gitea.svg`: Gitea's logo, from Gitea's own repository (`assets/logo.svg` of
  https://github.com/go-gitea/gitea), which is MIT-licensed; Simple Icons lists no other licence for it.
- `assets/forgejo.svg`: Forgejo's logo, created by Caesar Schinas and licensed under CC BY-SA 4.0
  (https://codeberg.org/forgejo/meta/src/branch/readme/branding).

## License

MIT (see `LICENSE`).
