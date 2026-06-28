export const EXTENSION_PASSKEY_AUTH_PATH = '/auth/passkey/extension'
// Recovery-based graduation pop-up: email/OAuth + PIN → export seed phrase HPKE-encrypted
// to a public key the extension provisions. Lives on the same NOCA app origin as
// the passkey pop-up, so the externally_connectable match already permits it.
export const EXTENSION_RECOVERY_AUTH_PATH = '/auth/recovery/extension'
