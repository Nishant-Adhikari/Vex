#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DIST_DIR = path.resolve(process.cwd(), "dist");
const MAX_PASSES = 20;
const RETRY_DELAY_MS = 100;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeEntry(entryPath) {
  let stat;
  try {
    stat = fs.lstatSync(entryPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    try {
      fs.unlinkSync(entryPath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    return;
  }

  for (const child of fs.readdirSync(entryPath)) {
    removeEntry(path.join(entryPath, child));
  }

  try {
    fs.rmdirSync(entryPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTEMPTY")
    ) {
      return;
    }
    throw error;
  }
}

function cleanDist() {
  if (!fs.existsSync(DIST_DIR)) {
    return;
  }

  let lastError = null;

  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    try {
      removeEntry(DIST_DIR);
    } catch (error) {
      lastError = error;
    }

    if (!fs.existsSync(DIST_DIR)) {
      return;
    }

    sleep(RETRY_DELAY_MS);
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Failed to remove ${DIST_DIR} after ${MAX_PASSES} passes.`);
}

cleanDist();
