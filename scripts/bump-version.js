#!/usr/bin/env node
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function main() {
  const root = process.cwd();
  const count = runGit(["rev-list", "--count", "HEAD"]);
  const version = `0.1.${count}`;

  const pkgPath = path.join(root, "package.json");
  const pkg = readJson(pkgPath);
  if (pkg.version !== version) {
    pkg.version = version;
    writeJson(pkgPath, pkg);
  }

  const versionPath = path.join(root, "VERSION");
  writeFileSync(versionPath, `${version}\n`, "utf-8");
}

main();
