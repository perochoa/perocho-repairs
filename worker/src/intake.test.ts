import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, dialable, parseIntake, rushed, stop } from "./intake.ts";

// Like SAME_DAY_FEES: less for a controller than a console.
const fees = { "PS5 controller stick drift fix (TMR upgrade)": 10, "PS5 deep cleaning": 20 };

const form = (fields: Record<string, string>) => {
	const data = new FormData();
	const base = {
		name: "Jane",
		email: "jane@example.com",
		phone: "416-555-0123",
		device: "DualSense",
		problem: "Left stick drifts",
		slot: "2026-11-02T15:00:00.000Z",
	};
	for (const [key, value] of Object.entries({ ...base, ...fields })) data.set(key, value);
	return data;
};

test("parses the picked time and the phone as typed", () => {
	const parsed = parseIntake(form({}), fees);
	assert.ok(parsed.ok);
	assert.equal(parsed.intake.slot, Date.parse("2026-11-02T15:00:00.000Z"));
	assert.equal(parsed.intake.phone, "416-555-0123");
});

test("takes same-day only from the checkbox, at the picked service's fee", () => {
	const quote = (fields: Record<string, string>) => {
		const parsed = parseIntake(form(fields), fees);
		assert.ok(parsed.ok);
		return { rush: parsed.intake.rush, rushFrom: parsed.intake.rushFrom };
	};
	assert.deepEqual(quote({ rush: "1", service: "PS5 controller stick drift fix (TMR upgrade)" }), { rush: 10, rushFrom: undefined });
	assert.deepEqual(quote({ rush: "1", service: "PS5 deep cleaning" }), { rush: 20, rushFrom: undefined });
	assert.deepEqual(quote({}), { rush: 0, rushFrom: undefined });
	assert.deepEqual(quote({ rush: "yes" }), { rush: 0, rushFrom: undefined });
});

test("quotes the range of fees for same-day without a known service", () => {
	for (const service of ["", "Something made up", "toString"]) {
		const parsed = parseIntake(form({ rush: "1", service }), fees);
		assert.ok(parsed.ok);
		assert.equal(parsed.intake.rush, 20);
		assert.equal(parsed.intake.rushFrom, 10);
		assert.match(describe(parsed.intake, "Mon, Nov 2, 10:00 a.m."), /\nSame-day: yes, \+\$10–\$20 \(paid in person\)\n/);
	}
	// One fee for everything is just that fee.
	const single = parseIntake(form({ rush: "1" }), { "PS5 deep cleaning": 20 });
	assert.ok(single.ok);
	assert.equal(single.intake.rushFrom, undefined);
});

test("shows same-day in the summary, and nothing when there isn't one", () => {
	const parsed = parseIntake(form({ rush: "1", service: "PS5 controller stick drift fix (TMR upgrade)" }), fees);
	assert.ok(parsed.ok);
	assert.match(describe(parsed.intake, "Mon, Nov 2, 10:00 a.m."), /\nSame-day: yes, \+\$10 \(paid in person\)\n/);
	assert.equal(rushed(parsed.intake), "SAME-DAY PS5 controller stick drift fix (TMR upgrade)");
	const plain = parseIntake(form({}), fees);
	assert.ok(plain.ok);
	assert.doesNotMatch(describe(plain.intake, "Mon, Nov 2, 10:00 a.m."), /Same-day/);
	assert.equal(rushed(plain.intake), "DualSense");
});

test("takes a quantity only when sent, as a whole number in range", () => {
	const plain = parseIntake(form({}), fees);
	assert.ok(plain.ok);
	assert.equal("quantity" in plain.intake, false);
	const sticks = parseIntake(form({ quantity: "4" }), fees);
	assert.ok(sticks.ok);
	assert.equal(sticks.intake.quantity, 4);
	assert.match(describe(sticks.intake, "Mon, Nov 2, 10:00 a.m."), /\nQuantity: 4\n/);
	assert.doesNotMatch(describe(plain.intake, "Mon, Nov 2, 10:00 a.m."), /Quantity/);
	for (const quantity of ["0", "-1", "2.5", "21", "two"]) {
		assert.equal(parseIntake(form({ quantity }), fees).ok, false, quantity);
	}
});

test("needs a time", () => {
	for (const slot of ["", "tomorrow-ish"]) assert.equal(parseIntake(form({ slot }), fees).ok, false, slot);
});

test("collapses whitespace in single-line fields only", () => {
	const parsed = parseIntake(form({ name: "Jane\r\n\tDoe", problem: "Drifts\nand clicks" }), fees);
	assert.ok(parsed.ok);
	assert.equal(parsed.intake.name, "Jane Doe");
	assert.equal(parsed.intake.problem, "Drifts\nand clicks");
});

test("needs an email that looks like an address", () => {
	for (const email of ["", "jane@", "@example.com", "jane doe@example.com"]) {
		assert.equal(parseIntake(form({ email }), fees).ok, false, email);
	}
});

test("needs a phone number with an area code", () => {
	for (const phone of ["4165550123", "(416) 555-0123", "+1 416.555.0123", "+44 20 7946 0958"]) {
		assert.equal(parseIntake(form({ phone }), fees).ok, true, phone);
	}
	for (const phone of ["", "555-0123", "call me", "416-555-0123 x12", "+1 416 555 0123 4567 89"]) {
		assert.equal(parseIntake(form({ phone }), fees).ok, false, phone);
	}
});

test("rejects missing fields", () => {
	assert.equal(parseIntake(form({ problem: "  " }), fees).ok, false);
	assert.equal(parseIntake(form({ device: "" }), fees).ok, false);
});

test("flags the honeypot as spam", () => {
	assert.deepEqual(parseIntake(form({ website: "http://spam" }), fees), { ok: false, spam: true });
});

test("dials the digits, keeping a leading +", () => {
	assert.equal(dialable("(416) 555-0123"), "4165550123");
	assert.equal(dialable(" +1 416.555.0123"), "+14165550123");
});

test("ends a sentence on a time with one period", () => {
	assert.equal(stop("Tue, Nov 3, 8:00 a.m."), "Tue, Nov 3, 8:00 a.m.");
	assert.equal(stop("Tue, Nov 3, 08:00"), "Tue, Nov 3, 08:00.");
});
