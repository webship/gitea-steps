#!/usr/bin/env bash
# Build the test site of this pack in a DDEV project: Gitea, or Forgejo with PRODUCT=forgejo, from the product's own
# image on the project's own PostgreSQL, the accounts of the suite, the private repository owner/webship-site and the
# sample content the features read (its issues, its milestone "Sprint 1" and a comment). It is what CI runs; on a
# machine with Docker and DDEV it makes the same site.
#
#   SITE_DIR=<folder>        where the project goes (default: ../gitea-site beside the pack)
#   PRODUCT=gitea|forgejo    the forge (default: gitea)
#   RELEASE=<x.y.z>          the release of the image (default: 1.27.3 for Gitea, 17.0.2 for Forgejo)
#   COUNTS_ONLY=1            build nothing: print what the site holds, one count a line (a run must leave them)
#
# The site answers at https://giteasteps.ddev.site, the address cucumber.js opens by default. Its own administrator's
# password, its secret key and its internal token are made for it, in $SITE_DIR/gitea/env, never printed.
set -euo pipefail

PACK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_DIR="${SITE_DIR:-${PACK}/../gitea-site}"
NAME=giteasteps
PRODUCT="${PRODUCT:-gitea}"
case "${PRODUCT}" in
  gitea) IMAGE="gitea/gitea:${RELEASE:-1.27.3}" ; PREFIX=GITEA ;;
  forgejo) IMAGE="codeberg.org/forgejo/forgejo:${RELEASE:-17.0.2}" ; PREFIX=FORGEJO ;;
  *) echo "PRODUCT is gitea or forgejo, not ${PRODUCT}." ; exit 1 ;;
esac
PASSWORD='dD.123123ddd'
# The scripts talk to the site's API over the plain HTTP of its own host, which needs no certificate on the runner.
export GITEA_SITE_URL="http://${NAME}.ddev.site"

if [ "${COUNTS_ONLY:-}" = 1 ] ; then
  python3 -I "${SITE_DIR}/gitea/counts.py" "${SITE_DIR}" | grep -E '^[a-z ]+: [0-9]+$'
  exit 0
fi

secret() { head -c 200 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9' | head -c "$1" ; }

mkdir -p "${SITE_DIR}/gitea" "${SITE_DIR}/.ddev"
SITE_DIR="$(cd "${SITE_DIR}" && pwd)"
cd "${SITE_DIR}"
ddev config --project-type=generic --project-name="${NAME}" --database=postgres:17 < /dev/null

cp "${PACK}/site/gitea-site.py" "${PACK}/site/counts.py" gitea/
( umask 077 && cat > gitea/env <<ENVEOF
GITEA_PRODUCT=${PRODUCT}
GITEA_IMAGE=${IMAGE}
APP_NAME=Webship site
DOMAIN=${NAME}.ddev.site
ROOT_URL=https://${NAME}.ddev.site/
HTTP_PORT=3000
DISABLE_SSH=true
DB_TYPE=postgres
DB_HOST=db:5432
DB_NAME=db
DB_USER=db
DB_PASSWD=db
SECRET_KEY=$(secret 64)
DISABLE_REGISTRATION=true
REQUIRE_SIGNIN_VIEW=false
${PREFIX}__security__INTERNAL_TOKEN=$(secret 100)
${PREFIX}__server__OFFLINE_MODE=true
${PREFIX}__server__LANDING_PAGE=explore
${PREFIX}__mailer__ENABLED=false
${PREFIX}__repository__DEFAULT_BRANCH=main
${PREFIX}__service__DEFAULT_KEEP_EMAIL_PRIVATE=true
${PREFIX}__cron_0x2E_update_checker__ENABLED=false
${PREFIX}__log__LEVEL=Warn
ENVEOF
)
printf 'GITEA_IMAGE=%s\n' "${IMAGE}" > .ddev/.env
cat > .ddev/docker-compose.gitea.yaml <<'YAMLEOF'
# Gitea or Forgejo: the product's own image on the project's PostgreSQL, at the project's address; the project's web
# container keeps the mail catcher. The same service as the Webship Workspace's Gitea plugin.
services:
  web:
    environment:
      - HTTP_EXPOSE=8093:80,8025:8025
      - HTTPS_EXPOSE=8457:80,8026:8025
  gitea:
    image: "${GITEA_IMAGE:-gitea/gitea:1.27.3}"
    container_name: ddev-${DDEV_SITENAME}-gitea
    labels:
      com.ddev.site-name: ${DDEV_SITENAME}
      com.ddev.approot: ${DDEV_APPROOT}
    restart: "no"
    expose:
      - "3000"
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - ${DDEV_APPROOT}/gitea/env
    volumes:
      - gitea_data:/data
    environment:
      VIRTUAL_HOST: ${DDEV_HOSTNAME}
      HTTP_EXPOSE: "80:3000"
      HTTPS_EXPOSE: "443:3000"
volumes:
  gitea_data:
    name: ddev-${DDEV_SITENAME}-gitea-data
YAMLEOF

echo "Starting ${PRODUCT} (${IMAGE}): the first start migrates the database."
ddev start -y < /dev/null
for attempt in $(seq 1 100) ; do
  code="$(ddev exec "curl -s -o /dev/null -m 10 -w '%{http_code}' http://gitea:3000/api/healthz" < /dev/null 2>/dev/null | tr -d '\r' | tail -1 || true)"
  [ "${code}" = 200 ] && break
  [ "${attempt}" = 100 ] && { echo "The forge did not answer (${code:-none})." ; ddev logs -s gitea --tail 60 < /dev/null || true ; exit 1 ; }
  sleep 3
done

# The site's own administrator, with a password the forge makes (never on a command line), kept in gitea/env.
out="$(ddev exec -s gitea "su-exec git bash -c 'cd /app/gitea && gitea --config /data/gitea/conf/app.ini --work-path /app/gitea admin user create --admin --username forge-admin --email forge-admin@example.invalid --random-password --must-change-password=false'" < /dev/null 2>&1)"
admin="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n "s/^.*generated random password is '\\(.*\\)'.*\$/\\1/p" | tail -n 1)"
out=''
[ -n "${admin}" ] || { echo "The site's administrator could not be made." ; exit 1 ; }
( umask 077 && printf 'GITEA_SITE_ADMIN=forge-admin\nGITEA_SITE_ADMIN_PASSWORD=%s\n' "${admin}" >> gitea/env )
admin=''

# The accounts of the suite (owner owns the repository, member and reader are its collaborators with write and read
# access, stranger has none), then the sample content.
python3 - "${PASSWORD}" <<'PYEOF' | python3 -I gitea/gitea-site.py "${SITE_DIR}" accounts content list
import base64, json, sys
password = sys.argv[1]
rows = [{'login': login, 'mail': login + '@example.com', 'password': password, 'fullname': login.capitalize() + ' Test',
         'admin': False, 'role': role, 'action': ''}
        for login, role in [('owner', 'owner'), ('member', 'write'), ('reader', 'read'), ('stranger', '')]]
print(base64.b64encode(json.dumps(rows).encode()).decode())
PYEOF

echo "The site: https://${NAME}.ddev.site (${PRODUCT})"
[ -n "${GITHUB_ENV:-}" ] && echo "LAUNCH_URL=https://${NAME}.ddev.site" >> "${GITHUB_ENV}"
exit 0
