.PHONY: promote-staging build manual-deploy prod-manual-deploy collect-openmhz

promote-staging:
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

build:
	npm run build

collect-openmhz:
	@test -n "$${DATE}" && test -n "$${TALKGROUP}" || \
		{ echo "Usage: make collect-openmhz DATE=YYYY-MM-DD TALKGROUP=6001" >&2; exit 1; }
	cd scripts/openmhz-browser-test && npm run collect -- --date="$${DATE}" --talkgroup="$${TALKGROUP}"

manual-deploy:
	git switch staging
	git pull --ff-only
	git status --short
	npm run build
	npx wrangler versions upload --preview-alias staging --message "staging $$(git rev-parse --short HEAD)"

# Promote staging to main, then deploy the same commit to the live Worker.
prod-manual-deploy:
	@test -z "$$(git status --porcelain)" || \
		{ echo "Error: You have uncommitted or untracked changes."; exit 1; }
	git switch staging
	git pull --ff-only origin staging
	$(MAKE) promote-staging
	npm run build
	npx wrangler deploy --message "production $$(git rev-parse --short HEAD)"
