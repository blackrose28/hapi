#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const cliRoot = join(repoRoot, 'cli');
const packagePath = join(cliRoot, 'package.json');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipBuild = args.includes('--skip-build');
const versionArg = args.find((arg) => !arg.startsWith('--'));

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function run(command: string, commandArgs: string[], cwd = repoRoot): void {
    console.log(`$ ${command} ${commandArgs.join(' ')}`);
    const result = spawnSync(command, commandArgs, {
        cwd,
        stdio: 'inherit',
        env: process.env
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`${command} exited with status ${result.status ?? 'unknown'}`);
    }
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string };
const version = versionArg?.replace(/^v/, '') ?? packageJson.version;
const prereleaseTag = version.split('-', 2)[1]?.split('.', 1)[0];

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`Invalid version: ${version}`);
}

if (packageJson.version !== version) {
    packageJson.version = version;
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

if (!skipBuild) {
    run('bun', ['run', 'build:single-exe:all']);
}

run('bun', ['run', 'prepare-npm-packages'], cliRoot);

const packages = [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
    'win32-x64',
    'main'
];

for (const packageName of packages) {
    const packageRoot = join(cliRoot, 'npm', packageName);
    const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
        bin?: Record<string, string>;
    };
    for (const binPath of Object.values(packageManifest.bin ?? {})) {
        if (!existsSync(join(packageRoot, binPath))) {
            fail(`Missing package binary: cli/npm/${packageName}/${binPath}`);
        }
    }

    const publishArgs = dryRun
        ? ['pack', '--dry-run']
        : [
            'publish',
            '--access',
            'public',
            ...(prereleaseTag ? ['--tag', prereleaseTag] : [])
        ];
    run('npm', publishArgs, packageRoot);
}

console.log(`${dryRun ? 'Validated' : 'Published'} npm packages for v${version}`);
