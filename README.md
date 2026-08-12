# Isomite

Isomite is an Obsidian plugin for controlled vault synchronization through a private [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket. It connects directly from Obsidian to R2 without a VPS, Worker, or custom synchronization server.

> [!IMPORTANT]
> Synchronization is new in `0.3.0`. Start with a copied test vault and a dedicated empty R2 bucket, and keep an independent backup while evaluating it.

## Current features

- Configure a Cloudflare R2 S3 API endpoint and bucket.
- Automatically fill the bucket name when the pasted endpoint ends in `/<bucket>`.
- Store bucket-scoped R2 credentials in the plugin's local Obsidian data.
- Test the connection with a signed, read-only S3 `ListObjectsV2` request.
- Initialize and verify Isomite-specific end-to-end encryption metadata.
- Derive independent AES-256-GCM content, hidden-path, and keyed-hash keys using PBKDF2-HMAC-SHA256 with 600,000 iterations.
- Export and import recovery keys.
- Work on Obsidian desktop and mobile using native WebCrypto and Obsidian's `requestUrl()` API.
- Avoid browser CORS limitations without operating a separate backend.
- Build a complete upload/download/delete/merge plan before changing either side.
- Review every proposed change before applying the complete plan.
- Start sync from the Obsidian ribbon and follow persistent percentage progress without opening plugin settings.
- Name each device and view recent encrypted sync history with simple change counts.
- Store encrypted immutable revisions and deduplicated encrypted file blobs.
- Preserve deletion history and recover interrupted local application with an encrypted journal.
- Pair additional devices with one generated secret code containing everything needed to connect.

## Install

### Community Plugins

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse** and search for **Isomite**.
3. Install and enable the plugin.

### Manual installation

1. Download `main.js` and `manifest.json` from the matching [GitHub release](https://github.com/ratatulieoi/obsidian-isomite/releases).
2. Create `<vault>/.obsidian/plugins/isomite/`.
3. Copy both files into that directory.
4. Reload Obsidian and enable **Isomite** under Community Plugins.

## Set up the first device

1. Open **Settings → Isomite** and choose **Initialize or connect to bucket**.
2. Create a dedicated private R2 bucket for the vault.
3. Create an R2 API token scoped to that bucket with **Object Read & Write** permission.
4. Copy the token's **Access Key ID** and **Secret Access Key** when Cloudflare displays them.
5. Enter:
   - **S3 API endpoint:** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - **Bucket:** the dedicated bucket name
   - **Access key ID**
   - **Secret access key**
6. Select **Test connection**.
7. Enter a long, unique vault passphrase.
8. Select **Verify encryption**. Sync remains disabled until the vault is encrypted and this device can unlock it.
9. Give the device a recognizable name, select **Sync**, approve the first upload, then copy the recovery key and store it in a password manager outside the vault.

A bucket URL ending in `/<bucket>` is also accepted. Isomite immediately separates the endpoint and fills the **R2 bucket name** field.

## Pair another device

1. On a synced device, select **Copy pairing code** under **Pair another device**.
2. Keep the code secret and store it somewhere safe. Anyone with it can access the synchronized vault.
3. On the new device, choose **Pair to existing Isomite vault** at the top of Isomite settings. The other settings collapse.
4. Paste the code, then select **Import and connect**.
5. Give the new device a recognizable name, select **Sync**, and approve the download.

The pairing code contains the R2 credentials and encryption access. It is a bearer secret, similar to a recovery key: do not post it publicly, leave it in shared clipboard history, or send it through an untrusted channel.

## Network use and privacy

Isomite makes direct HTTPS requests only to the Cloudflare R2 S3 API endpoint configured by the user. These requests inspect and synchronize the selected private bucket. Isomite has no developer-operated backend, analytics, telemetry, advertising, or account system.

The endpoint, bucket name, Access Key ID, Secret Access Key, encryption passphrase, and any imported recovery key are stored by Obsidian in `.obsidian/plugins/isomite/data.json`. Obsidian plugin settings are plaintext local data, so protect the device and vault accordingly. Sync baselines and crash journals stored there are separately encrypted. Isomite never uploads its own plugin folder. Do not commit or share `data.json`.

The encryption metadata object contains a random salt and encrypted key verifier. The salt is not secret, and the verifier does not reveal the passphrase. Vault content and revision metadata are encrypted before upload; filenames and paths are not stored as readable R2 object keys.

## Sync progress and interruption safety

Select the **Isomite sync** ribbon icon to scan and sync without opening settings. Only one sync can run at a time, and a persistent notice reports its current stage and percentage. Before commit, the ribbon changes to a stop icon and can cancel the run. Recent encrypted revisions can be viewed under **Settings → Isomite → Sync history**; the list is informational and does not restore older revisions.

Before the atomic remote-head commit, cancellation or failure does not activate the prepared revision or apply local changes. Deduplicated encrypted blobs uploaded during preparation may remain unreferenced until cleanup. After the commit, the ribbon becomes a non-cancellable progress icon and local application is stored in an encrypted journal; if Obsidian closes, Isomite resumes that committed work before allowing a newer sync.

## Current safety limits

- The connection test never writes to or deletes from R2.
- **Verify encryption** creates only `_isomite/encryption-v1.json`; it does not upload vault files.
- The first approved upload creates a local ZIP under `.isomite-backups/` before changing R2; this folder is never synchronized.
- Do not run Isomite alongside Obsidian Sync, Twine, LiveSync, or another vault synchronization system.
- Use a dedicated test bucket and a copied vault while Isomite is under development.

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

The production bundle is written to `main.js`. See [CONTRIBUTING.md](CONTRIBUTING.md) for issue, pull-request, security, and release guidance.

Release assets include GitHub build-provenance attestations. After downloading a release asset, verify it with:

```bash
gh attestation verify main.js --repo ratatulieoi/obsidian-isomite
```

## License

[MIT](LICENSE)
