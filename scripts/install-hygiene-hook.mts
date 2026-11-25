/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync, spawnSync } from 'child_process';
import { lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

const legacyHook = '#!/bin/sh\n# Installed by scripts/install-hygiene-hook.mts\nexec pnpm run precommit --staged\n';
const hook = `#!/bin/sh
# Installed by scripts/install-hygiene-hook.mts
# Git runs pre-commit from the root of the checkout that is committing.
if ! grep -Fq '// Supports the installed pre-commit hook: --staged' build/hygiene.ts 2>/dev/null; then
	printf '%s\\n' 'Skipping the VS Code hygiene hook: this checkout does not advertise staged hygiene support. Switch to a checkout with staged hygiene support to run the hook.' >&2
	exit 0
fi
exec pnpm run precommit --staged
`;
const cwd = path.resolve(import.meta.dirname, '..');

function main(): void {
	const args = process.argv.slice(2);
	const uninstall = args.length === 1 && args[0] === '--uninstall';
	if (args.length && !uninstall) {
		throw new Error('Usage: node scripts/install-hygiene-hook.mts [--uninstall]');
	}

	if (!uninstall) {
		const config = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd });
		if (config.status === 0) {
			throw new Error('core.hooksPath is configured. Keep your existing hooks; run pnpm run precommit --staged from your own hook if desired.');
		}
		if (config.error || config.status !== 1) {
			throw config.error ?? new Error('Could not read Git hook configuration.');
		}
	}

	// --git-common-dir deliberately addresses the default hook, even on uninstall after a
	// contributor switches to a custom hooks path. Linked worktrees share this directory.
	const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trimEnd();
	const hookDir = path.join(commonDir, 'hooks');
	const hookPath = path.join(hookDir, 'pre-commit');
	const existing = lstatSync(hookPath, { throwIfNoEntry: false });
	if (existing) {
		const contents = existing.isFile() ? readFileSync(hookPath, 'utf8') : undefined;
		if (contents === legacyHook && !uninstall) {
			throw new Error('Leaving the previous repository hygiene hook unchanged. Run node scripts/install-hygiene-hook.mts --uninstall, then rerun the installer to update it.');
		}
		if (contents !== hook && contents !== legacyHook) {
			throw new Error(`Leaving the existing pre-commit hook unchanged: ${hookPath}`);
		}
		if (uninstall) {
			unlinkSync(hookPath);
			console.log(`Removed the repository hygiene hook: ${hookPath}`);
		} else {
			console.log(`Repository hygiene hook is already installed: ${hookPath}`);
		}
	} else if (uninstall) {
		console.log('No repository hygiene hook to remove.');
	} else {
		mkdirSync(hookDir, { recursive: true });
		writeFileSync(hookPath, hook, { flag: 'wx', mode: 0o755 });
		console.log(`Installed the repository hygiene hook: ${hookPath}`);
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
