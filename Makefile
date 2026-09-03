.PHONY: promote-staging

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
