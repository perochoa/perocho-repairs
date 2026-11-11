// The drop-off picker's date arithmetic: what day follows what, which month and which page of the
// row a day is on, and whether its times have been read. Days are plain "YYYY-MM-DD" strings in the
// worker's zone, so nothing here may lean on the zone of the machine running it; the last test says
// so outright, and CI aside these are worth a run under a few TZ values:
//   TZ=Pacific/Auckland node --test src/scripts/slot-dates.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, addMonths, DAY, dayFormat, group, inRow, known, lastOf, noon, timeFormat, weekOf } from "./slot-dates.ts";

const toronto = "America/Toronto";

test("noon is noon UTC on the day, whatever the machine's zone", () => {
	assert.equal(noon("2026-11-11"), Date.UTC(2026, 10, 11, 12));
	assert.equal(new Date(noon("2026-01-01")).toISOString(), "2026-01-01T12:00:00.000Z");
});

test("days step across months, years and leap days", () => {
	assert.equal(addDays("2026-11-11", 0), "2026-11-11");
	assert.equal(addDays("2026-11-30", 1), "2026-12-01");
	assert.equal(addDays("2026-12-31", 1), "2027-01-01");
	assert.equal(addDays("2027-01-01", -1), "2026-12-31");
	assert.equal(addDays("2028-02-28", 1), "2028-02-29");
	assert.equal(addDays("2027-02-28", 1), "2027-03-01");
	assert.equal(addDays("2026-11-11", 31), "2026-12-12");
	assert.equal(addDays("2026-11-11", 365), "2027-11-11");
});

// A day is 23 or 25 hours long where the clocks change. Stepping by local midnights, or by 24 hours
// from one, repeats or skips a day there; stepping noon UTC doesn't.
test("days step one at a time through the clock changes", () => {
	// Toronto: forward on 2026-03-08, back on 2026-11-01. Auckland: back on 2026-04-05, forward on
	// 2026-09-27.
	const changes = [
		["2026-03-07", "2026-03-08", "2026-03-09"],
		["2026-10-31", "2026-11-01", "2026-11-02"],
		["2026-04-04", "2026-04-05", "2026-04-06"],
		["2026-09-26", "2026-09-27", "2026-09-28"],
	];
	for (const [before, change, after] of changes) {
		assert.equal(addDays(change, -1), before);
		assert.equal(addDays(change, 1), after);
		assert.equal(addDays(before, 2), after);
		assert.equal(noon(after) - noon(before), 2 * DAY);
	}
	// A week of days over the change has seven different dates.
	const week = Array.from({ length: 7 }, (_, i) => addDays("2026-10-29", i));
	assert.deepEqual(week, ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
});

test("months step by the month, not by the day of the month", () => {
	assert.equal(addMonths("2026-11", 0), "2026-11");
	assert.equal(addMonths("2026-11", 1), "2026-12");
	assert.equal(addMonths("2026-11", -1), "2026-10");
	// From January, a step that carried the 29th to the 31st along would land in March.
	assert.equal(addMonths("2026-01", 1), "2026-02");
	assert.equal(addMonths("2026-03", -1), "2026-02");
	assert.equal(addMonths("2026-10", 1), "2026-11");
	// Every month of a year comes up once, in order.
	assert.deepEqual(
		Array.from({ length: 12 }, (_, i) => addMonths("2026-01", i)),
		["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"],
	);
});

test("months step across the year in both directions", () => {
	assert.equal(addMonths("2026-12", 1), "2027-01");
	assert.equal(addMonths("2027-01", -1), "2026-12");
	// The calendar's last month: the current one and the eleven after it.
	assert.equal(addMonths("2026-11", 11), "2027-10");
	assert.equal(addMonths("2026-11", 14), "2028-01");
	assert.equal(addMonths("2026-01", -13), "2024-12");
});

test("a month's last day, in leap years and not", () => {
	assert.equal(lastOf("2026-01"), "2026-01-31");
	assert.equal(lastOf("2026-04"), "2026-04-30");
	assert.equal(lastOf("2026-12"), "2026-12-31");
	assert.equal(lastOf("2026-02"), "2026-02-28");
	assert.equal(lastOf("2028-02"), "2028-02-29");
	// Century years are leap only when they divide by 400.
	assert.equal(lastOf("2000-02"), "2000-02-29");
	assert.equal(lastOf("2100-02"), "2100-02-28");
});

// fix/full-week-from-today (#52): the row used to page by Sunday-to-Saturday weeks, so on any day but
// Sunday the first page had days already gone and fewer than seven to pick from. Pages now start
// today and every seventh day after.
test("the row's pages start today and run seven days each, whatever the weekday", () => {
	// 2026-11-11 is a Wednesday; the Sunday after it is still on the first page.
	const today = "2026-11-11";
	assert.equal(weekOf(today, today), 0);
	assert.equal(weekOf("2026-11-15", today), 0);
	assert.equal(weekOf("2026-11-17", today), 0);
	assert.equal(weekOf("2026-11-18", today), 1);
	assert.equal(weekOf("2026-11-24", today), 1);
	assert.equal(weekOf("2026-11-25", today), 2);
	// The row's last day, DAYS_AHEAD (31) on, is alone on a fifth page.
	assert.equal(weekOf(addDays(today, 30), today), 4);
	assert.equal(weekOf(addDays(today, 31), today), 4);
	// The same from a Saturday and from a Sunday.
	assert.equal(weekOf("2026-11-20", "2026-11-14"), 0);
	assert.equal(weekOf("2026-11-21", "2026-11-14"), 1);
	assert.equal(weekOf("2026-11-21", "2026-11-15"), 0);
	assert.equal(weekOf("2026-11-22", "2026-11-15"), 1);
});

test("a day's page doesn't slip where the clocks change or the year ends", () => {
	// A first page over Toronto's 25-hour day, and one over its 23-hour day.
	assert.equal(weekOf("2026-11-04", "2026-10-29"), 0);
	assert.equal(weekOf("2026-11-05", "2026-10-29"), 1);
	assert.equal(weekOf("2026-03-11", "2026-03-05"), 0);
	assert.equal(weekOf("2026-03-12", "2026-03-05"), 1);
	assert.equal(weekOf("2027-01-02", "2026-12-27"), 0);
	assert.equal(weekOf("2027-01-03", "2026-12-27"), 1);
});

test("the worker's zone decides a time's day, not UTC or the machine", () => {
	const day = dayFormat(toronto);
	// 11:30 at night in Toronto is already the next day in UTC, and the day after next in Auckland.
	assert.equal(day.format(Date.parse("2026-11-12T04:30:00Z")), "2026-11-11");
	assert.equal(day.format(Date.parse("2026-11-12T05:00:00Z")), "2026-11-12");
	// In summer Toronto is four hours behind, not five.
	assert.equal(day.format(Date.parse("2026-07-02T03:59:00Z")), "2026-07-01");
	assert.equal(day.format(Date.parse("2026-07-02T04:00:00Z")), "2026-07-02");
	assert.equal(dayFormat("Pacific/Auckland").format(Date.parse("2026-11-11T11:00:00Z")), "2026-11-12");
	assert.equal(dayFormat("UTC").format(Date.parse("2026-12-31T23:59:59Z")), "2026-12-31");
});

test("times are grouped under their day in the worker's zone, in the order they came", () => {
	const slots = [
		{ start: "2026-11-11T15:00:00.000Z" }, // 10:00 a.m.
		{ start: "2026-11-11T15:30:00.000Z" },
		{ start: "2026-11-12T04:30:00.000Z" }, // 11:30 p.m., still the 11th in Toronto
		{ start: "2026-11-13T22:00:00.000Z" }, // 5:00 p.m. on the 13th; the 12th has none
	];
	const byDay = group(slots, dayFormat(toronto), timeFormat(toronto));
	assert.deepEqual([...byDay.keys()], ["2026-11-11", "2026-11-13"]);
	assert.equal(byDay.has("2026-11-12"), false);
	// The value is the worker's own string, since the form sends it back as it came.
	assert.deepEqual(
		byDay.get("2026-11-11")!.map(({ value }) => value),
		["2026-11-11T15:00:00.000Z", "2026-11-11T15:30:00.000Z", "2026-11-12T04:30:00.000Z"],
	);
	// The label's spacing and its a.m./p.m. differ between ICU versions; the clock time doesn't.
	const labels = byDay.get("2026-11-11")!.map(({ label }) => label);
	assert.match(labels[0], /^10:00\sa\.?m\.?$/i);
	assert.match(labels[1], /^10:30\sa\.?m\.?$/i);
	assert.match(labels[2], /^11:30\sp\.?m\.?$/i);
	assert.match(byDay.get("2026-11-13")![0].label, /^5:00\sp\.?m\.?$/i);
});

test("grouping nothing gives no days", () => {
	assert.equal(group([], dayFormat(toronto), timeFormat(toronto)).size, 0);
});

test("times on a day the clocks change stay on that day", () => {
	// 2026-11-01 in Toronto runs from 04:00Z to 05:00Z the next day: 25 hours, with 1:30 a.m. twice.
	const back = group(
		[{ start: "2026-11-01T04:00:00Z" }, { start: "2026-11-01T05:30:00Z" }, { start: "2026-11-01T06:30:00Z" }, { start: "2026-11-02T04:59:00Z" }, { start: "2026-11-02T05:00:00Z" }],
		dayFormat(toronto),
		timeFormat(toronto),
	);
	assert.deepEqual([...back.keys()], ["2026-11-01", "2026-11-02"]);
	assert.equal(back.get("2026-11-01")!.length, 4);
	// 2026-03-08 runs from 05:00Z to 04:00Z the next day: 23 hours.
	const forward = group([{ start: "2026-03-08T04:59:00Z" }, { start: "2026-03-08T05:00:00Z" }, { start: "2026-03-09T03:59:00Z" }, { start: "2026-03-09T04:00:00Z" }], dayFormat(toronto), timeFormat(toronto));
	assert.deepEqual(
		[...forward].map(([day, times]) => [day, times.length]),
		[
			["2026-03-07", 1],
			["2026-03-08", 2],
			["2026-03-09", 1],
		],
	);
});

test("a month is in the row only when its last day is", () => {
	// Today is 2026-11-11 and the row runs 31 days, to 2026-12-12.
	const lastDay = "2026-12-12";
	assert.equal(inRow("2026-11", lastDay), true);
	// December is half in the row: its days after the 12th need the month's own fetch.
	assert.equal(inRow("2026-12", lastDay), false);
	assert.equal(inRow("2027-01", lastDay), false);
	// The cut-off itself: a row ending on a month's last day holds all of it, a day short doesn't.
	assert.equal(inRow("2026-11", "2026-11-30"), true);
	assert.equal(inRow("2026-11", "2026-11-29"), false);
	assert.equal(inRow("2027-02", "2027-02-28"), true);
	assert.equal(inRow("2028-02", "2028-02-28"), false);
	assert.equal(inRow("2028-02", "2028-02-29"), true);
	// Over the year's end.
	assert.equal(inRow("2026-12", "2027-01-05"), true);
	assert.equal(inRow("2027-01", "2027-01-05"), false);
});

test("a day in the row is known once the row has loaded, whatever months have", () => {
	const lastDay = "2026-12-12";
	const none = new Set<string>();
	assert.equal(known("2026-11-11", lastDay, false, none), false);
	assert.equal(known("2026-11-11", lastDay, true, none), true);
	// The cut-off day is the row's.
	assert.equal(known("2026-12-12", lastDay, true, none), true);
	assert.equal(known("2026-12-12", lastDay, false, new Set(["2026-12"])), false);
});

test("a day past the row is known once its month has been fetched", () => {
	const lastDay = "2026-12-12";
	// The day after the cut-off is in the same month as the row's end, and still waits for it.
	assert.equal(known("2026-12-13", lastDay, true, new Set()), false);
	assert.equal(known("2026-12-13", lastDay, true, new Set(["2026-12"])), true);
	assert.equal(known("2026-12-13", lastDay, false, new Set(["2026-12"])), true);
	assert.equal(known("2027-01-01", lastDay, true, new Set(["2026-12"])), false);
	// The picker passes its Map of fetched months; only has() is read.
	assert.equal(known("2027-01-01", lastDay, true, new Map([["2027-01", {}]])), true);
	// Before the first response there's no row yet, so every day counts as past it.
	assert.equal(known("2026-11-11", "", false, new Set()), false);
});

// The helpers take and give days as strings and do their arithmetic in UTC, so the machine's own
// zone, which is the customer's and may be far from the shop's, has no say in any of the above.
test("none of it reads the machine's zone", () => {
	const zones = ["America/Toronto", "UTC", "Pacific/Auckland", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
	const run = () => ({
		days: [addDays("2026-10-31", 1), addDays("2026-03-08", 1), addDays("2026-12-31", 1), addDays("2026-03-01", -1)],
		months: [addMonths("2026-12", 1), addMonths("2026-01", -1), lastOf("2028-02")],
		week: weekOf("2026-11-05", "2026-10-29"),
		grouped: [...group([{ start: "2026-11-12T04:30:00.000Z" }], dayFormat(toronto), timeFormat(toronto))],
	});
	const zone = process.env.TZ;
	try {
		// Node rereads TZ when it's set, so one run covers them all.
		const results = zones.map((name) => {
			process.env.TZ = name;
			assert.equal(new Intl.DateTimeFormat().resolvedOptions().timeZone, name);
			return run();
		});
		for (const result of results) assert.deepEqual(result, results[0]);
		assert.deepEqual(results[0].days, ["2026-11-01", "2026-03-09", "2027-01-01", "2026-02-28"]);
		assert.deepEqual(results[0].months, ["2027-01", "2025-12", "2028-02-29"]);
		assert.equal(results[0].week, 1);
		assert.equal(results[0].grouped[0][0], "2026-11-11");
	} finally {
		if (zone === undefined) delete process.env.TZ;
		else process.env.TZ = zone;
	}
});
