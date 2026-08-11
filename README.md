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
- Store encrypted immutable revisions and deduplicated encrypted file blobs.
- Preserve deletion history and recover interrupted local application with an encrypted journal.
- Pair additional devices with one encrypted bundle containing the R2 connection and encryption access, protected by a separate one-time password.

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
7. Enter a long, unique encryption passphrase.
8. Select **Verify encryption** to initialize or verify this bucket's Isomite encryption metadata.
9. Select **Review sync**, approve the first upload, then export the recovery key and store it in a password manager outside the vault.

A bucket URL ending in `/<bucket>` is also accepted. Isomite immediately separates the endpoint and fills the **R2 bucket name** field.

## Pair another device

1. On a synced device, enter a new one-time password under **Pair another device** and copy the encrypted bundle.
2. Send the bundle and its one-time password through separate channels.
3. On the new device, choose **Pair to existing Isomite vault** at the top of Isomite settings. The other settings collapse.
4. Paste the bundle and one-time password, then select **Import and connect**.
5. Select **Review sync** and approve the download.

The bundle contains R2 credentials and encryption access, but those values are encrypted with AES-256-GCM and a key derived from the one-time password. Anyone who obtains both can access the R2 vault, so treat them as secrets and use a fresh password for every device.

## Network use and privacy

Isomite makes direct HTTPS requests only to the Cloudflare R2 S3 API endpoint configured by the user. These requests inspect and synchronize the selected private bucket. Isomite has no developer-operated backend, analytics, telemetry, advertising, or account system.

The endpoint, bucket name, Access Key ID, Secret Access Key, encryption passphrase, and any imported recovery key are stored by Obsidian in `.obsidian/plugins/isomite/data.json`. Obsidian plugin settings are plaintext local data, so protect the device and vault accordingly. Sync baselines and crash journals stored there are separately encrypted. Isomite never uploads its own plugin folder. Do not commit or share `data.json`.

The encryption metadata object contains a random salt and encrypted key verifier. The salt is not secret, and the verifier does not reveal the passphrase. Vault content and revision metadata are encrypted before upload; filenames and paths are not stored as readable R2 object keys.

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
