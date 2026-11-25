@issues
Feature: The issues of the repository
  A member reads the repository's issues and works an issue of its own: a comment, the time spent on it, its assignee,
  closing and reopening it. What a scenario makes goes after it, with its comments and its time.

  Background:
    Given I am a logged in user with the "member" user

  Scenario: The list of open issues and one issue of the sample content
    When I open the issues of the repository "owner/webship-site"
    Then the issue list should show "The greeting script says Helo instead of Hello"
    And the issue list should show "An issue opened by someone outside the project"
    When I open the issue "The greeting script says Helo instead of Hello"
    Then the issue should be "open"
    And the issue should show the comment "The script is in the repository" by "owner"
    And the issue should be assigned to "member"
    And the milestone of the issue should be "Sprint 1"

  Scenario: A comment, the time spent and the assignee of an issue
    Given there is an issue "Webship test work" in the repository "owner/webship-site"
    When I open the issue "Webship test work"
    And I add the comment "Checked on the test site" to the issue
    And I log "0.5" hours on the issue
    And I assign the issue to "member"
    Then the issue should show the comment "Checked on the test site" by "Member Test"
    And the time spent on the issue should be "30 minutes"
    And the issue should be assigned to "Member Test"

  Scenario: An issue closed leaves the list, and reopened comes back
    Given there is an issue "Webship test close" in the repository "owner/webship-site"
    When I open the issue "Webship test close"
    And I close the issue
    Then the issue should be "closed"
    When I open the issues of the repository "owner/webship-site"
    Then the issue list should not show "Webship test close"
    When I open the issue "Webship test close"
    And I reopen the issue
    Then the issue should be "open"

  Scenario: A new issue through the form
    Given there is no issue "Webship test form" in the repository "owner/webship-site"
    When I create an issue "Webship test form" in the repository "owner/webship-site"
    Then the issue should be "open"
    When I open the issues of the repository "owner/webship-site"
    Then the issue list should show "Webship test form"
