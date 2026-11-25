# Publishing on addons.mozilla.org

The extension is listed on AMO; the companion is not an add-on and ships as a
GitHub release (see the main README, *Release*).

`metadata.json` holds the listing (summary and description in English and
Spanish, categories, links) and the notes for reviewers. `npm run submit`
sends it with the build and the source archive.

## First submission

1. Sign in at <https://addons.mozilla.org/developers/> and create API
   credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Check the version in `src/manifest.json`: AMO rejects a version it has
   already seen, unlisted uploads included.
3. Submit:

   ```sh
   export WEB_EXT_API_KEY=user:12345:67   # JWT issuer
   export WEB_EXT_API_SECRET=...          # JWT secret
   npm ci
   npm run submit
   ```

   This builds `dist/`, archives the committed source (`git archive HEAD`, so
   commit first) and uploads both with `metadata.json`. It returns once the
   upload is validated; review happens afterwards, and AMO emails the result.
4. In the Developer Hub, finish what the API doesn't set:
   - **Privacy policy**: paste `PRIVACY.md`. Required, since audio is sent to a
     provider.
   - **Screenshots**: settings page, captions on a video, the popup.
   - **Compatibility**: Firefox for desktop only (no Android: it has no
     native messaging, and isn't tested there).

## Later versions

Bump the version (see the main README, *Release*), commit, then `npm run submit`.
Listing text in `metadata.json` only applies on the first submission; change it
in the Developer Hub afterwards (and keep the file in step).

## If review asks about…

- **The bundled code**: the source archive and `approval_notes` give the build
  steps (Node 22, `npm ci && npm run build`).
- **nativeMessaging**: explained in `approval_notes`; the companion's source is
  `companion/` in the same repository.
