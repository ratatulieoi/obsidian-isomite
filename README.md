# Isomite: encrypted Obsidian sync with Cloudflare R2

**Your notes. Your bucket. One Sync button.**

Isomite is a private, end-to-end encrypted **Obsidian sync plugin** that keeps a vault synchronized across desktop and mobile through your own [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket.

Obsidian connects directly to R2. There is no VPS to maintain, no Worker to deploy, no Isomite account, and no developer-operated sync server. If you want an Obsidian Sync alternative with storage in your own Cloudflare account, but do not want to run a self-hosted server, this is what Isomite is built for.

## What you get

- **Two-way Obsidian vault sync** between desktop and mobile devices
- **End-to-end encryption** for file contents, filenames, paths, and sync history
- **One-button Sync** from the Obsidian ribbon
- A clear confirmation screen before files are uploaded, downloaded, merged, or deleted
- **Private Cloudflare R2 storage** using a bucket and API token you control
- One reusable secret **pairing code** for connecting any of your devices
- Named devices and a simple, encrypted **sync history**
- Safe conflict handling, local trash for deletions, and recovery after interrupted syncs
- No analytics, advertising, account system, or developer backend

## How Sync works

Press **Sync**. Isomite then:

1. Checks the latest encrypted version in R2.
2. Scans the current vault.
3. Compares both sides with the last successful sync.
4. Shows exactly what will change.
5. Applies the complete sync only after you confirm.
6. Saves a new encrypted revision to R2.

A file changed only on this device is uploaded. A file changed only on another device is downloaded. Safe text changes can be merged. When that is not safe, Isomite keeps both versions rather than silently discarding one. If deletion conflicts with an edit, you choose which one wins.

If Obsidian closes after R2 has accepted a sync, Isomite remembers the unfinished local work and resumes it before starting another sync. If a device's saved checkpoint no longer matches R2, Isomite compares both sides again and repairs the checkpoint safely.

## Install from Obsidian Community Plugins

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse**.
3. Search for **Isomite**.
4. Install and enable it.

### Manual installation

1. Download `main.js` and `manifest.json` from the same [GitHub release](https://github.com/ratatulieoi/obsidian-isomite/releases).
2. Create `<vault>/.obsidian/plugins/isomite/`.
3. Copy both files into that folder.
4. Reload Obsidian and enable **Isomite** under Community Plugins.

## Set up your first device

You need a Cloudflare account, a dedicated private R2 bucket, and an R2 API token scoped to that bucket with **Object Read & Write** permission.

1. Open **Settings → Isomite**.
2. Choose **Initialize or connect to bucket**.
3. Enter the R2 connection details:
   - **S3 API endpoint:** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - **R2 bucket name**
   - **Access Key ID**
   - **Secret Access Key**
4. Select **Test connection**.
5. Enter a long, unique **vault passphrase**.
6. Select **Verify encryption**. Sync remains disabled until this succeeds.
7. Give the device a recognizable name, such as `Work laptop` or `Android phone`.
8. Select **Sync**, inspect the changes, then select **Confirm and sync**.
9. Copy the recovery key and save it in a password manager outside the vault.

You can also paste an R2 URL ending in `/<bucket>`. Isomite separates the endpoint and bucket name automatically.

> [!IMPORTANT]
> Initialize Isomite with a dedicated empty bucket. Do not point a new Isomite vault at a bucket containing unrelated files.

## Pair another device

Copy your pairing code once, keep it somewhere safe, and use it to connect any of your devices. You do not need to enter the endpoint, credentials, or vault passphrase one field at a time.

1. On a connected device, open **Settings → Isomite → Pair another device**.
2. Select **Copy pairing code**.
3. On the new device, choose **Pair to existing Isomite vault**.
4. Paste the full code and select **Import and connect**.
5. Name the new device, select **Sync**, and confirm the download.

The pairing code contains the R2 connection and encryption access needed to open the vault. Treat it like a password: anyone with the code can access the synchronized vault. Keep it out of public messages, screenshots, shared clipboard history, and the vault itself.

## Encryption, in plain language

### Vault passphrase

The vault passphrase creates the keys that encrypt the vault before data leaves Obsidian. Every device must be able to unlock the same encrypted vault.

### Recovery key

The recovery key is an emergency way to unlock the encrypted vault if the passphrase is forgotten. It contains sensitive key material. Save it outside the vault, preferably in a password manager.

### Pairing code

The pairing code is for adding a device. It includes both R2 access and encryption access. It is more convenient than entering setup details manually, but it must remain secret.

Isomite uses AES-256-GCM and derives separate keys for content encryption, hidden object names, and keyed content hashes. The remote bucket does not contain readable note names or vault paths.

## Sync history

Open **Settings → Isomite → Sync history** to see recent encrypted revisions. Each entry shows:

- Date and time
- Device name
- Revision number
- Added, updated, deleted, and conflict counts

Sync history is currently informational. It does not restore an older revision.

## Safety and conflict handling

- The first approved upload creates a local ZIP backup under `.isomite-backups/`.
- Deletions use the vault's local trash instead of permanently deleting files immediately.
- R2 revisions are immutable, and the current revision changes atomically.
- A second device cannot silently overwrite a revision committed first by another device.
- Cancellation before commit applies none of the confirmed changes.
- After commit, Isomite finishes safely and resumes after interruption if necessary.
- Error notices explain what happened, whether anything was committed, and what to do next.
- Startup and save triggers only check for pending changes. They never apply changes without confirmation.

## Privacy and local secrets

Isomite sends HTTPS requests only to the Cloudflare R2 S3 endpoint you configure. It has no telemetry, analytics, advertising, developer-operated backend, or Isomite account service.

The endpoint, bucket name, Access Key ID, Secret Access Key, vault passphrase, and imported recovery key are stored locally by Obsidian in `.obsidian/plugins/isomite/data.json`. Obsidian plugin settings are plaintext local data, so protect the device and never commit or share that file. Sync checkpoints and interruption journals inside it are separately encrypted.

Cloudflare can see normal storage metadata such as object sizes, request timing, and the Isomite object-key structure. It cannot read the encrypted vault content, filenames, paths, or revision details without the vault key.

## Before you use it

- Do not run Isomite alongside any official or unofficial Obsidian sync solution on the same vault.
- Keep an independent backup. Synchronization is not a replacement for backup.
- Use one dedicated R2 bucket per Isomite vault.
- Cloudflare R2 usage and billing belong to your Cloudflare account.
- Isomite requires Obsidian `1.13.0` or newer.

## Frequently asked questions

### Is Isomite a self-hosted Obsidian sync server?

No server is required. Isomite connects directly from Obsidian to a private Cloudflare R2 bucket. The storage account is yours, while Cloudflare operates the storage service.

### Is this the official Obsidian Sync service?

No. Isomite is an independent community plugin and is not affiliated with the official Obsidian Sync service.

### Does encrypted Obsidian sync work on mobile?

Yes. Isomite uses Obsidian's network API and native WebCrypto, so the same encrypted R2 sync format works on Obsidian desktop and mobile.

### Does Isomite sync automatically?

It can check for changes after startup or saves, but it does not apply them automatically. You still confirm the sync plan.

### Can I inspect my notes in the R2 dashboard?

No. Note contents, filenames, paths, and revision metadata are encrypted before upload. The R2 dashboard shows encrypted Isomite objects rather than readable vault files.

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

The production bundle is written to `main.js`. See [CONTRIBUTING.md](CONTRIBUTING.md) for issue, pull-request, security, and release guidance.

Release assets include GitHub build-provenance attestations. Verify a downloaded release asset with:

```bash
gh attestation verify main.js --repo ratatulieoi/obsidian-isomite
```

## License

[MIT](LICENSE)
