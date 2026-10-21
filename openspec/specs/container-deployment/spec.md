# container-deployment Specification

## Purpose
Running the tool in a locally built container: the multi-stage, non-root Node.js 24 image with `/config` and `/data` volumes, the compose and `.env` examples that run `schedule --once` in a loop with secrets from the environment only, and the CI check that builds and runs the image without publishing it.
## Requirements
### Requirement: Container image
The repository SHALL contain a multi-stage `Dockerfile` on Node.js 24 slim that runs as a non-root user, reads its config from `/config/apaleo-datev.config.yaml`, writes exports to `/data`, and uses `apaleo-datev` as entry point with `schedule --once` as default command.

#### Scenario: Run a one-off export in the container
- **WHEN** the user runs the locally built image with the config and mapping mounted at `/config`, a volume at `/data`, `APALEO_CLIENT_SECRET` set, and the arguments `export --month 2026-10`
- **THEN** the export file is written under `/data` and the container exits with the export's exit code

#### Scenario: Non-root
- **WHEN** the container starts
- **THEN** the process runs as user `node`, not root

### Requirement: Secrets from the environment only
The container SHALL need no secret in the mounted config: `APALEO_CLIENT_SECRET` SHALL come from the environment, and other overrides SHALL be limited to the documented allow-list of scalar keys from the `cli` capability plus `APALEO_DATEV_TIMEZONE`.

#### Scenario: Compose with env file
- **WHEN** the user copies `.env.example` to `.env`, fills in the secret and runs `docker compose -f docker-compose.example.yml up -d --build`
- **THEN** the loop runs `schedule --once` with the secret from `.env` and the config from the mounted file

#### Scenario: Array key through the environment
- **WHEN** the compose file sets `APALEO_DATEV_PROPERTIES=BSP`
- **THEN** the run fails with the message that `properties` can only be set in the config file

### Requirement: Compose and env examples
The repository SHALL contain `docker-compose.example.yml` (one locally built service, restart policy, config and data volumes, env file, a `while sleep` loop around `schedule --once`) and `.env.example` listing the secret variable names with empty values, and `docs/docker.md` SHALL document the loop and the host-cron alternative.

#### Scenario: No secret values committed
- **WHEN** the repository is inspected
- **THEN** `.env.example` contains only variable names with empty values and `.env` is git-ignored

#### Scenario: No customer data committed
- **WHEN** the documented compose or host-cron setup creates `config/`, `data/` and `schedule.log` inside the clone
- **THEN** git ignores all three, as well as a root `mapping-*.csv`, so `git add -A` cannot commit Berater or Mandant numbers, the mapping or exported bookings

### Requirement: Image build check without publishing
CI SHALL build the image and run it with `--help` and `--version` on every pull request, and SHALL NOT log in to or push to any container registry.

#### Scenario: Pull request
- **WHEN** a pull request changes the Dockerfile
- **THEN** the `docker` job builds the image, runs both commands, and pushes nothing

