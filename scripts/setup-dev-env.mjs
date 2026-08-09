import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../api/.env', import.meta.url);
if (existsSync(target)) {
  console.log('api/.env already exists; no secrets were changed.');
  process.exit(0);
}

const template = readFileSync(new URL('../api/.env.example', import.meta.url), 'utf8');
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});
const replacements = {
  '__GENERATE_SESSION_SECRET__': randomBytes(32).toString('base64url'),
  '__GENERATE_JWT_PRIVATE_KEY__': Buffer.from(privateKey).toString('base64'),
  '__GENERATE_JWT_PUBLIC_KEY__': Buffer.from(publicKey).toString('base64')
};
const env = Object.entries(replacements).reduce(
  (value, [placeholder, replacement]) => value.replace(placeholder, replacement),
  template
);
mkdirSync(new URL('../api/', import.meta.url), { recursive: true });
writeFileSync(target, env, { mode: 0o600 });
console.log('Created api/.env with new local RSA keys. Add Google credentials before using Google sign-in.');
