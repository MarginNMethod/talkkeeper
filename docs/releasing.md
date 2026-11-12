# Releasing

Releases are built by `.github/workflows/release.yml` and distributed only through GitHub
Releases. There is no app-store submission.

## Test the installers without publishing

Open **Actions → Release → Run workflow** on any branch. It builds the installers on macOS,
Windows and Linux and keeps them as downloadable workflow artifacts for 7 days. Nothing is
published.

## Publish a version

1. Set the same version in `apps/desktop/src-tauri/tauri.conf.json`, the root `Cargo.toml`
   (`[workspace.package]`), and `apps/desktop/package.json`, and merge that change.
2. Tag the merge commit and push the tag: `git tag v0.1.0 && git push origin v0.1.0`.
   The workflow checks that the tag matches the app version.
3. The workflow creates a **draft pre-release** with the installers attached. Only maintainers
   can see a draft. Download and try the installers, edit the release notes, then press
   **Publish release** when you are happy.

## Notes

- Builds are unsigned. macOS bundles are ad-hoc signed, which still shows a one-time warning
  (see the README for how users open them).
- The Intel macOS build is cross-compiled on an Apple Silicon runner and is best-effort: if it
  fails, the other installers are still produced.
- Linux packages are built on Ubuntu 22.04 for wider compatibility.
- Test the installer on real machines before publishing; permissions (microphone, Accessibility,
  Screen Recording) behave differently in an installed app than in a development build.
