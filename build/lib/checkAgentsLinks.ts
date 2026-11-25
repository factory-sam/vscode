/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

/**
 * Run with `node build/lib/checkAgentsLinks.ts`. Checks single-line inline links
 * and images in root AGENTS.md, with bare or angle-bracket destinations and
 * optional quoted titles. Supports `./`, repo-root `/`, and URL-encoded names.
 * Only Git-tracked files and directories count. Queries and fragments are
 * ignored, as are external URLs, fragment-only links, comments, and fenced
 * or inline code. Reference links, HTML links, and complex Markdown (nested
 * brackets, multiline links, parentheses in bare destinations) are not parsed.
 */
const root = new URL('../../', import.meta.url);
const guide = readFileSync(new URL('AGENTS.md', root), 'utf8');
const files = new Set(execFileSync('git', ['ls-files', '--cached', '-z'], {
	cwd: root,
	encoding: 'utf8',
	maxBuffer: 16 * 1024 * 1024
}).split('\0').filter(Boolean));
const directories = new Set(['.']);
for (const file of files) {
	for (let dir = posix.dirname(file); !directories.has(dir); dir = posix.dirname(dir)) {
		directories.add(dir);
	}
}

const inline = /<!--.*?-->|(?<comment><!--).*|\\.|(?<ticks>`+)(?!`).*?(?<!`)\k<ticks>(?!`)|!?\[[^[\]]*\]\([ \t]*(?:<(?<angle>[^<>]*)>|(?<bare>[^\s<>()]+))(?:[ \t]+(?:"[^"]*"|'[^']*'))?[ \t]*\)/g;
const fenceMarker = /^ {0,3}(?<marker>`{3,}|~{3,})(?<rest>.*)$/;
let fence: string | undefined;
let inComment = false;
let checked = 0;
let broken = 0;

for (const [index, rawLine] of guide.split(/\r?\n/).entries()) {
	let line = rawLine;
	if (inComment) {
		const end = line.indexOf('-->');
		if (end === -1) {
			continue;
		}
		inComment = false;
		line = line.slice(end + 3);
	}
	const { marker, rest } = fenceMarker.exec(line)?.groups ?? {};
	if (fence) {
		if (marker?.[0] === fence[0] && marker.length >= fence.length && !rest.trim()) {
			fence = undefined;
		}
		continue;
	}
	if (marker && (marker[0] === '~' || !rest.includes('`'))) {
		fence = marker;
		continue;
	}

	for (const match of line.matchAll(inline)) {
		const { angle, bare, comment } = match.groups!;
		if (comment) {
			inComment = true;
			break;
		}
		const destination = angle ?? bare;
		const path = destination?.split(/[?#]/, 1)[0];
		if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) {
			continue;
		}

		checked++;
		let reason: string;
		try {
			const decoded = decodeURIComponent(path);
			const target = posix.normalize(decoded.replace(/^\//, '')).replace(/\/$/, '') || '.';
			if (posix.isAbsolute(target) || target === '..' || target.startsWith('../')) {
				reason = 'path leaves the repository';
			} else if (directories.has(target) || (!decoded.endsWith('/') && files.has(target))) {
				continue;
			} else {
				reason = 'no tracked target';
			}
		} catch {
			reason = 'invalid URL encoding';
		}
		broken++;
		console.error(`AGENTS.md:${index + 1}: ${reason}: ${JSON.stringify(destination)}`);
	}
}

console.log(`AGENTS.md: checked ${checked} local link(s), ${broken} broken.`);
if (broken) {
	process.exitCode = 1;
}
