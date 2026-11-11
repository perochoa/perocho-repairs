// Settings the site and the worker each keep a copy of, checked against each other.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { site } from "../../src/site.ts";
import { wranglerVars } from "../scripts/wrangler-vars.ts";
import { MAX_QUANTITY } from "./intake.ts";

// Each service's title and same-day fee, from its frontmatter. The fields are plain one-line
// `key: value`s there, so this doesn't need a YAML parser.
const services = () => {
	const dir = `${import.meta.dirname}/../../src/content/services`;
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => {
			const frontmatter = readFileSync(`${dir}/${file}`, "utf8").split("---")[1];
			const value = (key: string) => frontmatter.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1].trim();
			return [value("title"), Number(value("sameDay"))];
		});
};

test("the site quotes the same-day fees the worker charges, by service", () => {
	assert.deepEqual(wranglerVars().SAME_DAY_FEES, Object.fromEntries(services()));
});

test("the form offers no more items than the worker takes", () => {
	assert.equal(site.maxQuantity, MAX_QUANTITY);
});
