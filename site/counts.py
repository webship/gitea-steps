#!/usr/bin/env python3
"""What a Gitea or Forgejo test site holds, one count a line, through the forge's REST API as the site's own
administrator (its values in <site folder>/gitea/env, never printed). A run of the suite must leave every count as it
found it: CI compares them before and after each run.

    python3 counts.py <site folder>
"""

import importlib.util
import os
import sys

# The site's script is read, never compiled into a cache beside it.
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('gitea_site', os.path.join(HERE, 'gitea-site.py'))
site_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_module)


def main():
    site = site_module.Site(sys.argv[1])
    repo = site_module.REPO
    issues = site.pages('/repos/%s/issues' % repo, {'state': 'all', 'type': 'issues'})
    comments = site.pages('/repos/%s/issues/comments' % repo)
    times = site.pages('/repos/%s/times' % repo)
    milestones = site.pages('/repos/%s/milestones' % repo, {'state': 'all'})
    labels = site.pages('/repos/%s/labels' % repo)
    collaborators = site.pages('/repos/%s/collaborators' % repo)
    users = site.pages('/admin/users')
    open_issues = [i for i in issues if i['state'] == 'open']
    assigned = [i for i in issues if i.get('assignees')]
    print('issues: %d' % len(issues))
    print('open issues: %d' % len(open_issues))
    print('assigned issues: %d' % len(assigned))
    print('comments: %d' % len(comments))
    print('tracked times: %d' % len(times))
    print('milestones: %d' % len(milestones))
    print('labels: %d' % len(labels))
    print('collaborators: %d' % len(collaborators))
    print('users: %d' % len(users))


if __name__ == '__main__':
    main()
