1. Add CLI commands using the existing API client and text-file input guard.
2. Verify HTTP contracts, multiline input, UUID validation and file boundaries using a local HTTP test server.
3. Run required Go checks in the managed isolated environment; preserve failures and distinguish unrelated baseline failures.
4. Deliver the CLI and the dependent bridge changes in separate main-targeted PRs. Do not deploy or start real Agent processes as part of local testing.
