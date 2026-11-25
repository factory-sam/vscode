/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { suite, test } from 'node:test';

suite('hygiene', () => {

	test('rejects requested files that enter no hygiene checker', () => {
		const repositoryRoot = path.join(import.meta.dirname, '../../..');
		const result = spawnSync(process.execPath, [
			'--experimental-strip-types',
			'build/hygiene.ts',
			'src/vs/editor/contrib/colorPicker/browser/images/opacity-background.png',
		], {
			cwd: repositoryRoot,
			encoding: 'utf8',
		});

		assert.deepStrictEqual({
			status: result.status,
			hasNoMatchError: result.stderr.includes('No hygiene-eligible files matched the requested paths'),
		}, {
			status: 1,
			hasNoMatchError: true,
		});
	});

	test('rejects lint configuration that differs from the index before running staged checks', () => {
		const fixture = mkdtempSync(path.join(os.tmpdir(), 'vscode-staged-hygiene-'));
		const repositoryRoot = path.join(import.meta.dirname, '../../..');
		const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8' });
		try {
			git('init', '--quiet', '--template=', '--initial-branch=fixture');
			writeFileSync(path.join(fixture, 'oxlint.config.ts'), 'export default {};\n');
			writeFileSync(path.join(fixture, '.eslint-ignore'), '# Initially present\n');
			git('add', '.');
			const initial = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
				cwd: fixture,
				encoding: 'utf8',
				input: `tree ${git('write-tree').trim()}\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nInitial configuration\n`,
			}).trim();
			git('update-ref', 'HEAD', initial);

			mkdirSync(path.join(fixture, 'src'));
			writeFileSync(path.join(fixture, 'src', 'file.ts'), 'export const value = 1;\n');
			git('add', 'src/file.ts');
			writeFileSync(path.join(fixture, 'oxlint.config.ts'), 'throw new Error("unstaged config");\n');
			unlinkSync(path.join(fixture, '.eslint-ignore'));
			writeFileSync(path.join(fixture, 'src', '.oxlintrc.json'), '{}\n');
			const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'build', 'hygiene.ts'), '--staged'], {
				cwd: fixture,
				encoding: 'utf8',
			});
			assert.deepStrictEqual({
				status: result.status,
				diagnostic: result.stderr.trim().split(/\r?\n/),
				startedChecks: result.stdout.includes('Starting hygiene'),
			}, {
				status: 1,
				diagnostic: [
					'Hygiene cannot use configuration that differs from the index. Stage these changes or set them aside:',
					'.eslint-ignore',
					'oxlint.config.ts',
					'src/.oxlintrc.json',
				],
				startedChecks: false,
			});
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
