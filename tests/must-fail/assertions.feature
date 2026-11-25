@must-fail
Feature: Assertions that must fail
  Each scenario asserts something that is not true on the test site: its last step must fail with the message its
  description announces, and a hint. The scenarios only read; tests/check-must-fail.js runs them.

  Scenario: A session that is not the account named
    Fails with: Expected the session to be "Owner Test", but it is
    Given I am a logged in user with the "member" user
    Then I should be logged in as "Owner Test"

  Scenario: A login that worked is not refused
    Fails with: Expected the login to be refused with "Username or password is incorrect.", but
    Given I am not logged in
    When I log in with the "member" user
    Then the login should be refused with "Username or password is incorrect."

  Scenario: An issue the list does not show
    Fails with: Expected to see the issue "Webship test nothing" in the list
    Given I am a logged in user with the "member" user
    When I open the issues of the repository "owner/webship-site"
    Then the issue list should show "Webship test nothing"

  Scenario: A state the issue is not in
    Fails with: Expected the issue to be closed, but it says "Open".
    Given I am a logged in user with the "member" user
    When I open the issue "The greeting script says Helo instead of Hello"
    Then the issue should be "closed"

  Scenario: A comment the issue does not have
    Fails with: Expected to see the comment "Webship test nothing"
    Given I am a logged in user with the "member" user
    When I open the issue "The greeting script says Helo instead of Hello"
    Then the issue should show the comment "Webship test nothing"

  Scenario: An assignee the issue does not have
    Fails with: Expected the issue to be assigned to "owner", but the sidebar shows
    Given I am a logged in user with the "member" user
    When I open the issue "The greeting script says Helo instead of Hello"
    Then the issue should be assigned to "owner"

  Scenario: A member who may close the issue
    Fails with: Expected no close button for this session, but the issue has one.
    Given I am a logged in user with the "member" user
    When I open the issue "The greeting script says Helo instead of Hello"
    Then I should not be able to close the issue

  Scenario: A repository a member may open
    Fails with: Expected the repository owner/webship-site to be refused, but the site answered 200
    Given I am a logged in user with the "member" user
    Then I should be refused the repository "owner/webship-site"

  Scenario: A milestone that does not hold the issue
    Fails with: Expected to see the issue "The usage line spells greeting as greting" in the milestone
    Given I am a logged in user with the "member" user
    When I open the milestone "Sprint 1" of the repository "owner/webship-site"
    Then the milestone should list the issue "The usage line spells greeting as greting"
