.DEFAULT_GOAL := help

.PHONY: help openmhz-browser promote-staging build manual-deploy prod-manual-deploy collect-openmhz wrangler-login db-upload db-reset calls-from-db evidence-from-db evidence-to-db db-sync promote-db

# Reject the removed database selector instead of silently accepting an old command.
ifneq ($(filter db-upload db-reset calls-from-db evidence-from-db evidence-to-db db-sync promote-db,$(MAKECMDGOALS)),)
ifneq ($(origin D1_DATABASE),undefined)
$(error D1_DATABASE is no longer supported. Working DB commands use staging; promote-db copies staging to production)
endif
endif

# Keep command descriptions beside each target so help stays current.
help: ## List available make commands (also the default for plain make).
	@awk 'BEGIN {FS = ":.*## "; print "Available commands:"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

openmhz-browser: ## Open collector Chromium on port 9222; run in the Pi desktop terminal (TALKGROUP defaults to 6001).
	chromium --remote-debugging-port=9222 \
		--remote-debugging-address=127.0.0.1 \
		--user-data-dir="$$HOME/.config/chromium-openmhz" \
		"https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=$${TALKGROUP:-6001}"

wrangler-login: ## Sign in to Cloudflare with Wrangler.
	@test -x node_modules/.bin/wrangler || { echo "Run npm ci first to install Wrangler." >&2; exit 1; }
	./node_modules/.bin/wrangler login

# Working database commands always use staging; no database override is supported.
db-sync: ## Pull staging, fill first-time transcripts, export authoritative admin data, commit and push.
	@python3 db/sync_db.py

db-upload: ## Upload JSON to staging only (afpd-data-staging); no database parameter.
	@python3 db/upload_d1.py

db-reset: ## Back up staging, then recreate its JSON-managed tables; no database parameter.
	@python3 db/upload_d1.py --recreate-all

calls-from-db: ## Copy staging transcripts and verified flags to calls.json; no database parameter.
	@python3 db/calls_from_db.py

evidence-from-db: ## Save all staging evidence reviews to data/db-evidenence-associations.json; no database parameter.
	@python3 db/evidence_from_db.py

evidence-to-db: ## Back up staging, then reupload the evidence JSON; separate from db-upload, no database parameter.
	@python3 db/evidence_from_db.py --upload

# This is the only Make command that changes the production database.
promote-db: ## Replace production DB with a staging snapshot, including evidence reviews; no production backup.
	@python3 db/promote_db.py

promote-staging: ## Promote staging to main using force-with-lease; does not deploy.
	@test "$$(git branch --show-current)" = "staging" || \
		{ echo "Error: You must be on the staging branch."; exit 1; }
	@test -z "$$(git status --porcelain)" || \
		{ echo "Error: You have uncommitted or untracked changes."; exit 1; }
	@git fetch origin
	@test "$$(git rev-parse staging)" = "$$(git rev-parse origin/staging)" || \
		{ echo "Error: Local staging has not been pushed to origin/staging."; exit 1; }
	@echo "Promoting this staging commit:"
	@git log -1 --oneline origin/staging
	@git push --force-with-lease origin origin/staging:main

build: ## Build the website.
	npm run build

collect-openmhz: ## Collect metadata (DATE=YYYY-MM-DD TALKGROUP=6001); does not start downloads locally.
	@test -n "$${DATE}" && test -n "$${TALKGROUP}" || \
		{ echo "Usage: make collect-openmhz DATE=YYYY-MM-DD TALKGROUP=6001" >&2; exit 1; }
	cd scripts/openmhz-browser-test && npm run collect -- --date="$${DATE}" --talkgroup="$${TALKGROUP}"

manual-deploy: ## Build and upload a staging preview.
	git switch staging
	git pull --ff-only
	git status --short
	npm run build
	npx wrangler versions upload --config wrangler.staging.jsonc --preview-alias staging --message "staging $$(git rev-parse --short HEAD)"

# Promote staging to main, then deploy the same commit to the live Worker.
prod-manual-deploy: ## Promote staging to main, build, and deploy production.
	@test -z "$$(git status --porcelain)" || \
		{ echo "Error: You have uncommitted or untracked changes."; exit 1; }
	git switch staging
	git pull --ff-only origin staging
	$(MAKE) promote-staging
	npm run build
	npx wrangler deploy --message "production $$(git rev-parse --short HEAD)"
