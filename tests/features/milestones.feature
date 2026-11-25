@milestones
Feature: The milestones of the repository
  The repository's milestones, and the open issues each holds. An issue goes into a milestone through the API.

  Background:
    Given I am a logged in user with the "member" user

  Scenario: The milestone of the sample content and its issue
    When I open the milestones of the repository "owner/webship-site"
    Then the milestones should list "Sprint 1"
    When I open the milestone "Sprint 1" of the repository "owner/webship-site"
    Then the milestone should list the issue "The greeting script says Helo instead of Hello"
    And the milestone should not list the issue "The usage line spells greeting as greting"

  Scenario: An issue made in a milestone shows in it
    Given there is an issue "Webship test sprint" in the milestone "Sprint 1" of the repository "owner/webship-site"
    When I open the milestone "Sprint 1" of the repository "owner/webship-site"
    Then the milestone should list the issue "Webship test sprint"
    When I open the issue "Webship test sprint"
    Then the milestone of the issue should be "Sprint 1"
