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
 * ignored, as are external URLs, fragment-only links, HTML comments, and code
 * examples. Handles standalone indented code, fences (including explicit block
 * quotes), and backtick spans within a paragraph. This is not a full Markdown
 * parser: reference links, raw HTML links, list container indentation, lazy
 * quote continuations, nested link labels, multiline links, and bare
 * parentheses in destinations are outside its scope.
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

// Scan exclusions and links together so comment markers within a code span,
// and backticks within a link label, do not start separate tokens.
const inline = /<!--[\s\S]*?-->|(?<comment><!--)[\s\S]*|\\[^\n]|(?<!`)(?<ticks>`+)(?!`)[\s\S]*?(?<!`)\k<ticks>(?!`)|!?\[[^[\]\n]*\]\([ \t]*(?:<(?<angle>[^<>\n]*)>|(?<bare>[^\s<>()]+))(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/g;
const quotePrefix = /^(?: {0,3}>[ \t]?)+/;
const fenceMarker = /^ {0,3}(?<marker>`{3,}|~{3,})(?<rest>.*)$/;
let fence: { marker: string; quoteDepth: number } | undefined;
let inComment = false;
let paragraph: string[] = [];
let paragraphStart = 0;
let paragraphQuoteDepth = 0;
let checked = 0;
let broken = 0;

/** Check one prose block; code spans cannot match across a block boundary. */
function checkParagraph(): void {
	const text = paragraph.join('\n');
	let lineNumber = paragraphStart;
	let lastOffset = 0;
	paragraph = [];
	for (const match of text.matchAll(inline)) {
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
		lineNumber += text.slice(lastOffset, match.index).split('\n').length - 1;
		lastOffset = match.index;
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
		console.error(`AGENTS.md:${lineNumber}: ${reason}: ${JSON.stringify(destination)}`);
	}
}

for (const [index, rawLine] of guide.split(/\r?\n/).entries()) {
	const prefix = quotePrefix.exec(rawLine)?.[0] ?? '';
	const quoteDepth = prefix.match(/>/g)?.length ?? 0;
	let line = rawLine.slice(prefix.length);
	const { marker, rest } = fenceMarker.exec(line)?.groups ?? {};
	if (fence) {
		if (quoteDepth >= fence.quoteDepth) {
			if (quoteDepth === fence.quoteDepth && marker?.[0] === fence.marker[0] && marker.length >= fence.marker.length && !rest.trim()) {
				fence = undefined;
			}
			continue;
		}
		// An unclosed fence inside a block quote ends with its container.
		fence = undefined;
	}

	const startsFence = marker && (marker[0] === '~' || !rest.includes('`'));
	const heading = /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line);
	if (!line.trim() || quoteDepth !== paragraphQuoteDepth || startsFence || heading) {
		checkParagraph();
	}
	if (inComment) {
		const end = line.indexOf('-->');
		if (end === -1) {
			continue;
		}
		inComment = false;
		line = line.slice(end + 3);
	} else if (startsFence) {
		fence = { marker, quoteDepth };
		continue;
	}
	if (!line.trim()) {
		continue;
	}
	// Unlike a fence, indented code cannot interrupt an open paragraph.
	if (!paragraph.length && /^(?: {0,3}\t| {4})/.test(line)) {
		continue;
	}
	if (!paragraph.length) {
		paragraphStart = index + 1;
		paragraphQuoteDepth = quoteDepth;
	}
	paragraph.push(line);
	if (heading) {
		checkParagraph();
	}
}
checkParagraph();

console.log(`AGENTS.md: checked ${checked} local link(s), ${broken} broken.`);
if (broken) {
	process.exitCode = 1;
}
