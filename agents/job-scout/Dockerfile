# job-scout pipeline runtime — ghcr.io/senthilsweb/job-scout
# Spec: openspec/changes/container-and-publishing/specs/container-runtime/spec.md
#
#   docker run --rm ghcr.io/senthilsweb/job-scout trends      # load -> export -> report
#   docker run --rm ghcr.io/senthilsweb/job-scout load        # boards -> ats_posting_raw
#   docker run --rm -e RUN_PAID_MATCH=yes --env-file .env \
#     ghcr.io/senthilsweb/job-scout match                     # PAID daily match
#
# The baked config.yaml is a working default. To run against your own
# state, mount a config and point JOB_SCOUT_CONFIG at it (absolute
# paths inside that config are used as-is):
#   docker run --rm -v /srv/js:/state -e JOB_SCOUT_CONFIG=/state/config.yaml \
#     ghcr.io/senthilsweb/job-scout trends
FROM python:3.12-slim

RUN pip install --no-cache-dir duckdb pyyaml certifi jinja2 python-dotenv

# Entrypoint lives outside /app so compose can bind the checkout over
# /app (image supplies deps, checkout supplies code + state).
COPY docker/entrypoint.sh /usr/local/bin/job-scout
RUN chmod +x /usr/local/bin/job-scout

WORKDIR /app
COPY tools/ tools/
COPY templates/ templates/
COPY config.yaml ./

ENTRYPOINT ["job-scout"]
CMD ["trends"]
