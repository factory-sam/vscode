/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/** Run the real checker against an isolated Git index and guide. */
function checkGuide(lines: readonly string[]) {
	const root = mkdtempSync(join(tmpdir(), 'check-agents-links-'));
	try {
		const checker = join(root, 'build', 'lib', 'checkAgentsLinks.ts');
		mkdirSync(join(root, 'build', 'lib'), { recursive: true });
		mkdirSync(join(root, 'docs'));
		copyFileSync(new URL('../checkAgentsLinks.ts', import.meta.url), checker);
		writeFileSync(join(root, 'docs', 'Guide file.md'), '');
		writeFileSync(join(root, 'docs', 'not-executed.mjs'), 'throw new Error("linked scripts must not execute");\n');
		writeFileSync(join(root, 'untracked.md'), '');
		writeFileSync(join(root, 'AGENTS.md'), lines.join('\n'));
		execFileSync('git', ['init', '--quiet'], { cwd: root });
		execFileSync('git', ['add', '--', 'docs'], { cwd: root });
		const { status, stdout, stderr } = spawnSync(process.execPath, [checker], { cwd: tmpdir(), encoding: 'utf8' });
		return { status, stdout: stdout.trim(), stderr: stderr.trim() };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test('counts only existing repository paths, not external links or fragments', () => {
	assert.deepStrictEqual(checkGuide([
		'[Guide](./docs/Guide%20file.md#unchecked) [Directory](/docs/ "Title")',
		'[Angle](<docs/Guide file.md>) [Script](docs/not-executed.mjs?raw=1)',
		'[External](https://not-a-real-domain.invalid/missing.md) [Scheme-relative](//not-a-real-domain.invalid/no.md)',
		'[Mail](mailto:user@example.invalid) [Fragment](#ignored)',
		'`[Example](ignored.md)` <!-- [Comment](ignored.md) -->',
	]), {
		status: 0,
		stdout: 'AGENTS.md: checked 4 local link(s), 0 broken.',
		stderr: '',
	});
});

test('skips quoted fences, indented code, and multiline backtick spans', () => {
	assert.deepStrictEqual(checkGuide([
		'[Before](/docs)',
		'',
		'> ```md',
		'> [Quoted example](missing.md)',
		'> ```',
		'>> ~~~~md',
		'>> [Nested quote](missing.md)',
		'>> ~~~~',
		'> [Quoted prose](/docs)',
		'',
		'    [Indented example](missing.md)',
		'\t[Tabbed example](missing.md)',
		'',
		'Use ``a',
		'[Multiline example](missing.md) with a ` tick',
		'`` alongside [the guide](<docs/Guide file.md>).',
		'',
		'> ~~~md',
		'> [Unclosed quoted fence](missing.md)',
		'[After the quote](/docs)',
		'',
		'***',
		'    [After a thematic break](missing.md)',
		'',
		'[Heading text](/docs)',
		'===',
		'    [After an equals underline](missing.md)',
		'[After the example](/docs)',
		'-',
		'    [After a hyphen underline](missing.md)',
		'  _ _ _',
		'    [After a spaced thematic break](missing.md)',
		'[Before a thematic break](/docs)',
		'* * *',
		'[After the thematic break](/docs)',
	]), {
		status: 0,
		stdout: 'AGENTS.md: checked 8 local link(s), 0 broken.',
		stderr: '',
	});
});

test('reports real broken links after examples with the original line numbers', () => {
	assert.deepStrictEqual(checkGuide([
		'```md',
		'[Fenced example](missing.md)',
		'```',
		'<!-- [Comment](ignored.md)',
		'```md',
		'--> [Wrong case](docs/guide%20file.md)',
		'',
		'No closing backtick in this paragraph: `',
		'',
		'` [Untracked](untracked.md) [Outside](%2e%2e/outside.md)',
		'Then a wrapped line in the same paragraph:',
		'    [Broken continuation](broken.md)',
		'',
		'===',
		'    [Not code after standalone equals](still-broken.md)',
		'[Broken heading](heading.md)',
		'---',
		'    [Code after ambiguous underline](ignored.md)',
		'[Broken after heading](after-heading.md)',
	]), {
		status: 1,
		stdout: 'AGENTS.md: checked 7 local link(s), 7 broken.',
		stderr: [
			'AGENTS.md:6: no tracked target: "docs/guide%20file.md"',
			'AGENTS.md:10: no tracked target: "untracked.md"',
			'AGENTS.md:10: path leaves the repository: "%2e%2e/outside.md"',
			'AGENTS.md:12: no tracked target: "broken.md"',
			'AGENTS.md:15: no tracked target: "still-broken.md"',
			'AGENTS.md:16: no tracked target: "heading.md"',
			'AGENTS.md:19: no tracked target: "after-heading.md"',
		].join('\n'),
	});
});
