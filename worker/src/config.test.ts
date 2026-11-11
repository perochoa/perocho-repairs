// Settings the site and the worker each keep a copy of, checked against each other.

import assert from "node:assert/strict";
import { test } from "node:test";
import { site } from "../../src/site.ts";
import { wranglerVars } from "../scripts/wrangler-vars.ts";
import { MAX_QUANTITY } from "./intake.ts";

test("the site quotes the rush fee the worker charges", () => {
	assert.equal(site.rushFee, wranglerVars().RUSH_FEE);
});

test("the form offers no more items than the worker takes", () => {
	assert.equal(site.maxQuantity, MAX_QUANTITY);
});
