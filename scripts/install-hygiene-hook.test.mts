/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { test } from 'node:test';

test('the installed hook only runs staged hygiene in compatible checkouts', () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'vscode-hygiene-hook-'));
	try {
		const checkout = path.join(root, 'checkout');
		const worktree = path.join(root, 'old worktree');
		const bin = path.join(root, 'bin');
		mkdirSync(checkout);
		mkdirSync(bin);
		writeFileSync(path.join(bin, 'pnpm'), '#!/bin/sh\nprintf "pnpm %s\\n" "$*"\n', { mode: 0o755 });
		const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env['PATH']}` };
		const git = (args: string[], cwd = checkout, input?: string) =>
			execFileSync('git', args, { cwd, encoding: 'utf8', env, input });
		const runHook = (cwd: string) => {
			const result = spawnSync('git', ['hook', 'run', 'pre-commit'], { cwd, encoding: 'utf8', env });
			assert.strictEqual(result.status, 0, result.stderr);
			return result;
		};

		git(['init', '--quiet', '--template=', '--initial-branch=fixture']);
		// Import an older fixture without depending on the developer's Git author configuration.
		const hygiene = readFileSync(path.join(import.meta.dirname, '..', 'build', 'hygiene.ts'), 'utf8');
		git(['fast-import', '--quiet'], checkout, [
			'commit refs/heads/old',
			'mark :1',
			'committer Fixture <fixture@example.invalid> 0 +0000',
			'data 3',
			'old',
			'M 100644 inline build/hygiene.ts',
			'data <<END',
			'// No staged support.',
			'END',
			'',
			'commit refs/heads/supported',
			'committer Fixture <fixture@example.invalid> 1 +0000',
			'data 9',
			'supported',
			'from :1',
			'M 100644 inline build/hygiene.ts',
			`data ${Buffer.byteLength(hygiene)}`,
			hygiene,
			'',
		].join('\n'));
		git(['switch', '--quiet', 'supported']);
		git(['worktree', 'add', '--quiet', '--detach', worktree, 'old']);
		const installer = path.join('scripts', 'install-hygiene-hook.mts');
		mkdirSync(path.join(checkout, 'scripts'));
		copyFileSync(path.join(import.meta.dirname, 'install-hygiene-hook.mts'), path.join(checkout, installer));

		execFileSync(process.execPath, [installer], { cwd: checkout, env });
		const hookPath = path.join(checkout, '.git', 'hooks', 'pre-commit');
		const installed = readFileSync(hookPath, 'utf8');
		assert.strictEqual(runHook(checkout).stderr.trim(), 'pnpm run precommit --staged');

		const linked = runHook(worktree);
		assert.match(linked.stderr, /Skipping the VS Code hygiene hook/);
		assert.doesNotMatch(linked.stderr, /pnpm run precommit/);
		git(['switch', '--quiet', 'old']);
		const older = runHook(checkout);
		assert.match(older.stderr, /Skipping the VS Code hygiene hook/);
		assert.doesNotMatch(older.stderr, /pnpm run precommit/);
		assert.strictEqual(readFileSync(hookPath, 'utf8'), installed);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
