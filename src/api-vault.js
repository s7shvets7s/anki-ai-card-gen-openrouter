(function initApiVault(global) {
  const VAULT_KEY = "apiProfilesVault";
  const LEGACY_KEY = "apiProfiles";
  const SESSION_KEY = "apiVaultSessionKey";
  const ITERATIONS = 250000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  class VaultLockedError extends Error {
    constructor(message = "API key storage is locked. Open the extension settings and enter the master password.") {
      super(message);
      this.name = "VaultLockedError";
    }
  }

  async function getState() {
    const local = await chrome.storage.local.get([VAULT_KEY, LEGACY_KEY]);
    if (!local[VAULT_KEY]) {
      return {
        enabled: false,
        locked: false,
        hasLegacyProfiles: Array.isArray(local[LEGACY_KEY]) && local[LEGACY_KEY].length > 0
      };
    }
    const session = await chrome.storage.session.get(SESSION_KEY);
    return {
      enabled: true,
      locked: !session[SESSION_KEY],
      hasLegacyProfiles: false
    };
  }

  async function loadProfiles(fallbackProfiles = []) {
    const local = await chrome.storage.local.get([VAULT_KEY, LEGACY_KEY]);
    const vault = local[VAULT_KEY];
    if (!vault) {
      return Array.isArray(local[LEGACY_KEY]) && local[LEGACY_KEY].length
        ? local[LEGACY_KEY]
        : fallbackProfiles;
    }

    const key = await getSessionKey();
    return decryptProfiles(vault, key);
  }

  async function saveProfiles(profiles) {
    const { [VAULT_KEY]: vault } = await chrome.storage.local.get(VAULT_KEY);
    if (!vault) {
      await chrome.storage.local.set({ [LEGACY_KEY]: profiles });
      return;
    }

    const key = await getSessionKey();
    const encrypted = await encryptProfiles(profiles, key, vault.salt);
    await chrome.storage.local.set({ [VAULT_KEY]: encrypted });
  }

  async function enable(profiles, passphrase) {
    validatePassphrase(passphrase);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt);
    const vault = await encryptProfiles(profiles, key, bytesToBase64(salt));
    const rawKey = await crypto.subtle.exportKey("raw", key);
    await chrome.storage.local.set({ [VAULT_KEY]: vault });
    await chrome.storage.local.remove(LEGACY_KEY);
    await chrome.storage.session.set({ [SESSION_KEY]: bytesToBase64(new Uint8Array(rawKey)) });
  }

  async function unlock(passphrase) {
    const { [VAULT_KEY]: vault } = await chrome.storage.local.get(VAULT_KEY);
    if (!vault) throw new Error("Protected API key storage has not been enabled yet.");
    const key = await deriveKey(passphrase, base64ToBytes(vault.salt));
    const profiles = await decryptProfiles(vault, key);
    const rawKey = await crypto.subtle.exportKey("raw", key);
    await chrome.storage.session.set({ [SESSION_KEY]: bytesToBase64(new Uint8Array(rawKey)) });
    return profiles;
  }

  async function lock() {
    await chrome.storage.session.remove(SESSION_KEY);
  }

  async function getSessionKey() {
    const session = await chrome.storage.session.get(SESSION_KEY);
    const raw = session[SESSION_KEY];
    if (!raw) throw new VaultLockedError();
    return crypto.subtle.importKey("raw", base64ToBytes(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function deriveKey(passphrase, salt) {
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptProfiles(profiles, key, saltValue) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(JSON.stringify(profiles))
    );
    return {
      version: 1,
      algorithm: "AES-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: ITERATIONS,
      salt: typeof saltValue === "string" ? saltValue : bytesToBase64(saltValue),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    };
  }

  async function decryptProfiles(vault, key) {
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(vault.iv) },
        key,
        base64ToBytes(vault.ciphertext)
      );
      const profiles = JSON.parse(decoder.decode(plaintext));
      if (!Array.isArray(profiles) || profiles.length === 0) {
        throw new Error("The encrypted profile list is empty or invalid.");
      }
      return profiles;
    } catch (error) {
      if (error?.message?.includes("profile list")) throw error;
      throw new Error("Wrong master password or damaged API key storage.");
    }
  }

  function validatePassphrase(passphrase) {
    if (String(passphrase || "").length < 8) {
      throw new Error("Master password must contain at least 8 characters.");
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  global.ApiVault = {
    VaultLockedError,
    getState,
    loadProfiles,
    saveProfiles,
    enable,
    unlock,
    lock
  };
})(globalThis);
