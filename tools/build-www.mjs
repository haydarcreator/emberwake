// Copies the game files the mobile app needs into www/ (Capacitor's webDir).
// Usage: node tools/build-www.mjs
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

const FILES = [
  'index.html', 'play.html', 'account.html', 'privacy.html', 'terms.html', 'favicon.ico', 'manifest.webmanifest',
  'css', 'js', 'shared', 'assets',
];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
// The app opens straight into the game.
writeFileSync('www/index.html', '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=play.html"><title>Emberwake</title>');
console.log('www/ ready');
