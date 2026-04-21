#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const pkg = JSON.parse(read("package.json"));
const version = pkg.version;
const errors = [];
const EXPECTED = {
  workflow: ".github/workflows/ci.yml",
};

function markerVersion(file) {
  const source = read(file);
  return source.match(/\*\*Version:\*\*\s*`?v?([0-9]+\.[0-9]+\.[0-9]+)[^`\n]*/)?.[1];
}

if (!version) errors.push("package.json missing version");

if (existsSync(path.join(root, "package-lock.json"))) {
  const lock = JSON.parse(read("package-lock.json"));
  if (lock.name !== pkg.name) {
    errors.push(`package-lock.json name ${lock.name} != package.json ${pkg.name}`);
  }
  if (lock.version !== version) {
    errors.push(`package-lock.json version ${lock.version} != package.json ${version}`);
  }
  if (lock.packages?.[""]?.version !== version) {
    errors.push(`package-lock packages[""].version ${lock.packages?.[""]?.version} != ${version}`);
  }
  if (lock.packages?.[""]?.name !== pkg.name) {
    errors.push(`package-lock packages[""].name ${lock.packages?.[""]?.name} != ${pkg.name}`);
  }
} else if (existsSync(path.join(root, "pnpm-lock.yaml"))) {
  const pnpmLock = read("pnpm-lock.yaml");
  if (!/^\s{2}\.:\s*$/m.test(pnpmLock)) {
    errors.push("pnpm-lock.yaml missing the root importer");
  }
} else {
  errors.push("missing package-lock.json or pnpm-lock.yaml");
}

// README.md, package.json, the lockfile root, and the in-app stamps are the release-version surfaces.
for (const file of ["README.md"]) {
  const found = markerVersion(file);
  if (!found) errors.push(`${file} missing **Version:** vX.Y.Z marker`);
  else if (found !== version) errors.push(`${file} version ${found} != package.json ${version}`);
}

const nvm = read(".nvmrc").trim();
if (pkg.engines?.node !== nvm) {
  errors.push(`package.json engines.node ${pkg.engines?.node} != .nvmrc ${nvm}`);
}
const packageManager = /^npm@(.+)$/.exec(pkg.packageManager ?? "")?.[1];
if (!packageManager) {
  errors.push("package.json packageManager must pin npm");
} else if (pkg.engines?.npm !== packageManager) {
  errors.push(
    `package.json engines.npm ${pkg.engines?.npm} != packageManager npm@${packageManager}`,
  );
}

const repositoryUrl = pkg.repository?.url
  ?.replace(/^git\+/, "")
  .replace(/\.git$/, "")
  .replace(/\/$/, "");
const repositoryName = repositoryUrl?.split("/").at(-1);
if (!repositoryUrl || repositoryName !== pkg.name) {
  errors.push(`package.json repository URL does not match package name ${pkg.name}`);
} else {
  if (pkg.homepage !== repositoryUrl) {
    errors.push(`package.json homepage ${pkg.homepage} != ${repositoryUrl}`);
  }
  if (pkg.bugs?.url !== `${repositoryUrl}/issues`) {
    errors.push(`package.json bugs.url ${pkg.bugs?.url} != ${repositoryUrl}/issues`);
  }
}

const engineSource = read("src/engine/version.ts");
const engineVersion = engineSource.match(/engineVersion\s*=\s*["']([^"']+)["']/)?.[1];
if (engineVersion !== version) {
  errors.push(`src/engine/version.ts version ${engineVersion ?? "missing"} != ${version}`);
}

const recordSource = read("src/components/record-view.tsx");
const appVersion = recordSource.match(/appVersion\s*=\s*["']([^"']+)["']/)?.[1];
if (appVersion !== version) {
  errors.push(`src/components/record-view.tsx version ${appVersion ?? "missing"} != ${version}`);
}

const workflow = read(EXPECTED.workflow);
const ciNodeFile = workflow.match(/^\s*node-version-file:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
if (ciNodeFile) {
  if (ciNodeFile !== ".nvmrc") {
    errors.push(`${EXPECTED.workflow} node-version-file ${ciNodeFile} != .nvmrc`);
  }
} else {
  const ciNode = workflow.match(/^\s*node-version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
  errors.push(
    `${EXPECTED.workflow} must use node-version-file: .nvmrc; found ${ciNode ?? "neither"}`,
  );
}

if (errors.length) {
  console.error("version-coherence FAILED:");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(`version-coherence OK — ${version}`);
