# Releasing the CLI

The npm package is `@shortcircuitcli/cli`. The `Release CLI` workflow in
`.github/workflows/release.yml` publishes it.

## When a release happens

The workflow runs when `main` receives a change to:

- `packages/cli/**`
- `packages/engine/**`
- `vendor/ShortCircuit-Packages` (the package registry submodule)
- `package.json`, `package-lock.json`, or `tsconfig.base.json`
- `scripts/test-packed-cli.mjs`
- `.github/workflows/release.yml`

It also supports manual runs from the Actions tab.

The workflow reads the version from `packages/cli/package.json`. If that exact
version is already on npm, it skips the install, test, build, and publish steps.
It still checks the version and ensures the `v<version>` tag and GitHub release
exist. If the version is new, it runs the release checks and publishes.

This means compiler and package changes can be merged without releasing
immediately. To publish, bump the CLI version.

## Versioning

Use semver:

- Patch: bug fixes and internal changes.
- Minor: new commands, options, or bundled packages.
- Major: breaking changes to commands, output, or package behavior.

The version in `packages/cli/package.json` is the version that gets published.
The package is published under the `latest` dist tag. Use a stable `x.y.z`
version greater than the latest published version. The workflow rejects
prerelease versions and versions older than the current latest.

## One-time setup: npm trusted publishing

The workflow uses npm trusted publishing through GitHub OIDC. It does not use a
long-lived `NPM_TOKEN` secret.

The package must already exist on npm. Its `repository.url` must point at
`https://github.com/samTime101/ShortCircuit`; the current package metadata
does. After this workflow is on `main`, run this from a machine logged in as an
owner of the `@shortcircuitcli` org:

```bash
npm trust github @shortcircuitcli/cli --file release.yml --repo samTime101/ShortCircuit --allow-publish
```

Complete the 2FA prompt. Confirm the configuration with:

```bash
npm trust list @shortcircuitcli/cli
```

The first publish after setup must be a new version. Version `0.1.0` is already
published, so bump to a new version, such as `0.1.1` or `0.2.0`, for the first
trusted release. A publish of an already published version is skipped and does
not validate the trusted publisher.

The trusted publisher must complete its first successful publish within two
days of creation. If it expires, revoke it from the package settings or with
`npm trust revoke`, then create it again.

The `--file` value is the workflow filename only. If the workflow is renamed,
update the trusted publisher as well.

After the first successful trusted publish, consider setting the package's
publishing access to require 2FA and disallow tokens in the npm package
settings. Trusted publishing continues to work.

## Releasing a compiler or CLI change

1. Make and test the change on a branch.
2. Update the version in `packages/cli/package.json`.
3. Refresh the lockfile:

   ```bash
   npm install --package-lock-only
   ```

4. Commit the change, the version, and the lockfile.
5. Push to `main`.
6. Open the Actions tab and watch the `Release CLI` workflow.

The workflow:

- typechecks the workspace;
- runs the full test suite;
- tests the package authoring CLI;
- builds the web app and CLI;
- tests the packed CLI install;
- publishes with automatic provenance;
- creates the `v<version>` tag;
- creates a GitHub release.

If the version is already published, the workflow skips the test, build, and
publish steps. Bump the version if you intended to release.

## Releasing a package registry change

The default packages live in the `vendor/ShortCircuit-Packages` submodule.

1. Add or update the package in the package repository.
2. Register it in `registry.json`.
3. From `vendor/ShortCircuit-Packages`, run:

   ```bash
   npm run package:build
   npm run package:test
   ```

4. Commit and push the package repository.
5. In this repository, commit the updated submodule pointer:

   ```bash
   git add vendor/ShortCircuit-Packages
   git commit -m "chore: update package submodule"
   ```

6. Bump the CLI version in `packages/cli/package.json`.
7. Refresh the lockfile:

   ```bash
   npm install --package-lock-only
   ```

8. Commit the version and lockfile and push to `main`.

The submodule pointer update changes the package snapshot that the CLI build
uses. The CLI version bump is what makes npm publish a new package. If you push
the submodule pointer without a version bump, the workflow runs and skips the
publish because the version is already on npm. No new package is shipped.

A change inside the package repository alone does not update this repository's
submodule pointer and does not trigger this workflow. The pointer commit is part
of the release.

## Manual release

Go to Actions, select `Release CLI`, choose `Run workflow`, and run it from
`main`. The same version check applies. Manual runs from other branches are
rejected.

## Verify a release

```bash
VERSION=0.2.0
npm view @shortcircuitcli/cli version
npm view "@shortcircuitcli/cli@$VERSION" dist.tarball
npm install -g @shortcircuitcli/cli@latest
shortcircuit package list
```

Set `VERSION` to the version you released.

## Updating an installed CLI

```bash
npm install -g @shortcircuitcli/cli@latest
```

or:

```bash
npm update -g @shortcircuitcli/cli
```

The explicit `@latest` install is the most reliable. Global npm installs do not
update automatically.

## Troubleshooting

### The workflow ran but did not publish

The version in `packages/cli/package.json` is already on npm. Bump the version
and push again.

### The workflow rejected the version

The version must use stable `x.y.z` semver and must not be older than the latest
npm version. Remove any prerelease suffix and bump past the current latest, then
push again.

### `EOTP` or `403` during publish

The trusted publisher is not configured, is configured for a different workflow
file, or the workflow is not running from `main`. Re-run the trusted publishing
setup and confirm that the workflow has `id-token: write` permission.

### `E404` during publish

Check that the package name is `@shortcircuitcli/cli` and that the workflow is
publishing to `https://registry.npmjs.org`.

### `npm ci` fails after a version bump

Run `npm install --package-lock-only`, commit the updated `package-lock.json`,
and push again.

### The package update is in the repository but not in the CLI

The `vendor/ShortCircuit-Packages` submodule pointer was not updated, or the
package registry was not rebuilt before committing. See
[Package authoring](PACKAGES.md) for the package checklist.

### The workflow created a tag but not a release

Re-run the workflow. The publish step is skipped because the version is already
on npm, and the release step creates the missing GitHub release.
