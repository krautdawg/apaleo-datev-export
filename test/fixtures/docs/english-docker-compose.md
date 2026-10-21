## Docker Compose (recommended)

```sh
git clone https://github.com/krautdawg/apaleo-datev-export.git
cd apaleo-datev-export
cp .env.example .env                 # fill in APALEO_CLIENT_SECRET
mkdir -p config data
cp apaleo-datev.config.example.yaml config/apaleo-datev.config.yaml   # then edit it
# put your mapping file(s) into config/, for example config/mapping-BSP.csv
sudo chown 1000:1000 data            # the container runs as user node (uid 1000)
docker compose -f docker-compose.example.yml up -d --build
docker compose -f docker-compose.example.yml logs -f
```

The service runs `schedule --once`, sleeps an hour, and repeats. The files appear in `./data/<property>/<YYYY-MM>/`.

If you skip the `chown`, Docker creates `./data` owned by root and every period fails with `E-EXPORT` and `EACCES: permission denied`, followed by the `chown` command to run. The run goes on with the other periods and exits 1; nothing is lost, the next run after the fix exports them.

`config/`, `data/` and `./schedule.log` (see host cron below) hold the Berater and Mandant numbers, the account mapping and the exported bookkeeping data. They live inside the clone, and `.gitignore` excludes them, so a `git add -A` does not pick them up. Back them up separately.

How the container is laid out:

| Path | What | Mount |
| --- | --- | --- |
| `/config` | `apaleo-datev.config.yaml` and the mapping CSVs; also the working directory | `./config`, read-only |
| `/data` | the exports (`APALEO_DATEV_OUTPUT_DIR=/data`, overrides `output.dir`) | `./data` |
| `/app` | the built tool | in the image |

Because the working directory is `/config`, a mapping path in the config such as `./mapping-BSP.csv` (the default for `properties[].mapping`) points into `config/`.

### Secrets and environment

The mounted config needs no secret: `APALEO_CLIENT_SECRET` comes from `.env`, which is git-ignored. Never put it in the config file; the tool refuses that. Besides the secret, only these scalar settings can come from the environment: `APALEO_DATEV_CONFIG`, `APALEO_DATEV_OUTPUT_DIR`, `APALEO_CLIENT_ID`, `APALEO_DATEV_BERATERNUMMER`, `APALEO_DATEV_MANDANTENNUMMER` and `APALEO_DATEV_TIMEZONE`. Lists such as `properties` stay in the config file: `APALEO_DATEV_PROPERTIES` is refused with a message saying so.

### One-off commands

With arguments, the compose service runs that single command and exits instead of looping:

```sh
docker compose -f docker-compose.example.yml run --rm apaleo-datev export --month 2026-10 --dry-run
docker compose -f docker-compose.example.yml run --rm apaleo-datev export --month 2026-10
docker compose -f docker-compose.example.yml run --rm apaleo-datev mapping check --property BSP
```

Use this to fill a gap after downtime longer than `schedule.catchUpDays`, or for `export --overwrite` after a late posting.

