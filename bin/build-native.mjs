#!/usr/bin/env node
// Builds the native helpers the service runs.
//
// macOS compiles three of them: an OCR helper against Vision, a simulator driver
// against AppKit, and the Rust bridge. Only the bridge exists elsewhere; Windows
// recognizes text through native/ocr_win.py and has no simulator to drive.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../src/config.mjs';
import { exe, isMac, isWin } from '../src/os.mjs';

const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

process.chdir(root);
mkdirSync('build', { recursive: true });

if (isMac) {
  // Paths are remapped so a build does not carry this machine's directory layout.
  process.env.RUSTFLAGS = `${process.env.RUSTFLAGS ?? ''} --remap-path-prefix=${process.env.HOME}=/builder --remap-path-prefix=/Volumes=/build --remap-path-prefix=${root}=/poki`;
  process.env.CFLAGS = `${process.env.CFLAGS ?? ''} -ffile-prefix-map=${process.env.HOME}=/builder -ffile-prefix-map=/Volumes=/build`;
  process.env.CXXFLAGS = `${process.env.CXXFLAGS ?? ''} -ffile-prefix-map=${process.env.HOME}=/builder -ffile-prefix-map=/Volumes=/build`;
  run('xcrun', ['swiftc', '-target', `${process.arch}-apple-macos15.0`, '-debug-prefix-map', `${root}=/poki`, 'native/ocr.swift', '-o', 'build/ocr']);
  run('xcrun', ['clang', `-ffile-prefix-map=${root}=/poki`, '-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'UniformTypeIdentifiers', 'native/simulator.m', '-o', 'build/simulator']);
}

run('cargo', ['build', '--release', '--manifest-path', 'native/bridge/Cargo.toml', '--target-dir', 'build/native-target', '--bin', 'poki-native', ...(isMac ? ['--example', 'unlock_iphone'] : [])]);

const built = join('build/native-target', 'release', exe('poki-native'));
copyFileSync(built, join('build', exe('poki-native')));
if (isWin) {
  // The OCR helper needs an interpreter and its engines, not a compile step.
  const engines = spawnSync('python', ['-c', 'import rapidocr, onnxruntime'], { stdio: 'ignore' });
  if (engines.status !== 0) console.error('Warning: native/ocr_win.py has no OCR engine yet. Run: pip install winsdk rapidocr onnxruntime-directml');
}
console.log(`Built build/${exe('poki-native')}${isMac ? ', build/ocr and build/simulator' : ''}.`);
