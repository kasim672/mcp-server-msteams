/**
 * Local AES-256-GCM credential encryption.
 *
 * v2 uses a random per-install key held in a user-only configuration directory,
 * rather than a predictable hostname/username-derived key. This is NOT
 * hardware-backed encryption: anyone who can read both the key file and
 * session files may still decrypt them. v1 decryption remains for migration.
 */
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const LEGACY_SALT = 'teams-mcp-credential-salt-v1';
const BASE_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'teams-mcp-server')
  : path.join(os.homedir(), '.teams-mcp-server');
const KEY_PATH = path.join(BASE_DIR, 'session.key');
let cachedKey: Buffer | null = null;

/** Read the user's random 256-bit key, creating it once on the first encrypt. */
function getKey(create: boolean): Buffer {
  if (cachedKey && fs.existsSync(KEY_PATH)) return cachedKey;
  cachedKey = null;
  if (create) {
    fs.mkdirSync(BASE_DIR, { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(KEY_PATH, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
    }
  }
  const loaded = fs.readFileSync(KEY_PATH);
  if (loaded.length !== 32) throw new Error('Invalid local session key length');
  cachedKey = loaded;
  return loaded;
}

function legacyKey(): Buffer {
  return crypto.scryptSync(`${os.hostname()}:${os.userInfo().username}`, LEGACY_SALT, 32);
}

export interface EncryptedData {
  iv: string;
  content: string;
  tag: string;
  version: number;
}

export function encrypt(plaintext: string): EncryptedData {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(true), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    content: ciphertext.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    version: 2,
  };
}

export function decrypt(data: EncryptedData): string {
  if (data.version !== 1 && data.version !== 2) {
    throw new Error(`Unsupported encryption version: ${data.version}`);
  }
  const key = data.version === 1 ? legacyKey() : getKey(false);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(data.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(data.content, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
