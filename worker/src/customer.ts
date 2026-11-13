// The customer's own link to their request, from the "received" and "confirmed" emails. It shows
// where the request stands and lets them cancel the drop-off, or move it to another open time, until
// that time has passed or the repair is marked done. Like the techs' links, opening it (or its list
// of times) changes nothing and the buttons POST, because mail scanners open the links in emails.
// A tech who needs a drop-off moved asks the customer to do it here, so moving one lives in one place.
//
// Approving, declining, cancelling, moving and the hourly job can all race. So each change here is
// one D1 batch, guarded by a check of the request as it is then, not as it was loaded: whatever won
// first stands, and the loser changes nothing. New calendar events go on before that batch, and the
// old ones come off after it, so the calendars are never left with nothing while the request still
// stands.

import { clear, findSlots, hold, type StrayEvent } from "./calendar.ts";
import { accessToken, createEvent } from "./google.ts";
import { formatTime, type Intake, stop } from "./intake.ts";
import * as notices from "./notices.ts";
import { customerLink, type OfferRow, type RequestRow, send, timeOf } from "./offers.ts";
import { escape, html, message, request as details } from "./pages.ts";
import { horizon, monthWindow, rowEnd, type Slot, zonedFormat } from "./slots.ts";

async function load(db: D1Database, token: string) {
	const request = await db.prepare("SELECT * FROM requests WHERE customer_token = ?").bind(token).first<RequestRow>();
	if (!request) return null;
	const { results: offers } = await db
		.prepare("SELECT * FROM offers WHERE request_id = ? ORDER BY position")
		.bind(request.id)
		.all<OfferRow>();
	const intake: Intake = JSON.parse(request.intake);
	return { request, offers, intake };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

// Still theirs to change: open or approved, not cancelled or marked done, and its time still ahead.
// Only decides what the page offers; the batches check it again (OPEN below) as they change it.
const changeable = (request: RequestRow, now = Date.now()) =>
	request.cancelled === null &&
	request.done === null &&
	(request.status === "pending" || request.status === "confirmed") &&
	request.slot_start > now;

// The same in SQL, for the statements of a change: ?1 is the request's id and ?2 the time now. A
// constant, so it's safe to put in the SQL as it is.
const OPEN = `EXISTS (SELECT 1 FROM requests WHERE id = ?1 AND slot_start > ?2 AND status IN ('pending', 'confirmed')
	AND cancelled IS NULL AND done IS NULL)`;
// And for a move, still at the status and time it's being moved from (?3 and ?4): one approved, or
// moved again in another tab, since then needs its own look at the times.
const UNMOVED = `EXISTS (SELECT 1 FROM requests WHERE id = ?1 AND slot_start > ?2 AND status = ?3 AND slot_start = ?4
	AND cancelled IS NULL AND done IS NULL)`;

// Takes every event off a request's offers in the same transaction as the change `guard` stands
// for. The first statement gives back the events, and the second puts them in stray_events, so if
// the worker stops before deleting them the hourly job still has them. A request's events are all
// on its offers, the booking too (on the approver's), so this is every one, however many techs'
// calendars an approved repair ends up on (#152).
const release = (db: D1Database, guard: string, params: unknown[], reopen: boolean) => [
	db.prepare(`SELECT calendar_id, hold_id AS event_id FROM offers WHERE request_id = ?1 AND hold_id IS NOT NULL AND ${guard}`).bind(...params),
	db.prepare(
		`INSERT OR IGNORE INTO stray_events (calendar_id, event_id)
		 SELECT calendar_id, hold_id FROM offers WHERE request_id = ?1 AND hold_id IS NOT NULL AND ${guard}`,
	).bind(...params),
	// A new time is a new question, so a move of an open request asks the techs who declined again.
	db.prepare(`UPDATE offers SET hold_id = NULL${reopen ? ", declined = 0" : ""} WHERE request_id = ?1 AND ${guard}`).bind(...params),
];

// Who can take the drop-off at a new time: while it's open, every tech it was offered to, since a
// new time asks them all again; once approved, only the tech who approved it, since the device
// comes to them.
const takers = ({ request, offers }: Loaded) =>
	request.status === "confirmed" ? offers.filter((offer) => offer.token === request.confirmed_by) : offers;

const offerLink = (origin: string, offer: OfferRow) => `${origin}/offers/${offer.token}`;

// The events a request has on the calendars at a time, each by the offer it goes on: a tentative
// hold for each tech free then while it's open, or the approver's booking once it's approved. This
// is the one place that says so for a move; should #152 put an approved repair on every tech's
// calendar, it's what changes. They're made before anything is recorded, so a move that loses a
// race leaves only these to delete. Throws when none could be made, and then nothing has changed.
async function place(env: Env, token: string, loaded: Loaded, slot: Slot, origin: string): Promise<Map<OfferRow, string>> {
	const { request, intake } = loaded;
	const techs = takers(loaded);
	const free = slot.techs.map((i) => techs[i]);
	const time = formatTime(slot.start, env.TIME_ZONE);
	const made = await Promise.allSettled(
		free.map((offer) =>
			request.status === "confirmed"
				? createEvent(
						token,
						offer.calendar_id,
						{
							summary: notices.bookedSummary(intake),
							description: notices.bookedDescription(intake, time, offer.name, env.DROPOFF_ADDRESS),
							start: slot.start,
							end: slot.end,
							timeZone: env.TIME_ZONE,
						},
						true,
					)
				: hold(env, token, offer.calendar_id, slot, intake, offerLink(origin, offer)),
		),
	);
	const events = new Map<OfferRow, string>();
	made.forEach((result, i) => {
		if (result.status === "fulfilled") events.set(free[i], result.value);
		else console.error(result.reason);
	});
	if (events.size === 0) throw (made.find((result) => result.status === "rejected") as PromiseRejectedResult).reason;
	return events;
}

async function cancel(env: Env, { request, offers, intake }: Loaded) {
	// Open or approved, whichever it is now: an approval that just won still goes, along with the
	// booking it made (see `confirm` in offers.ts).
	const now = Date.now();
	const db = env.DB;
	const [released, , , cancelled, current] = await db.batch([
		...release(db, OPEN, [request.id, now], false),
		db.prepare(`UPDATE requests SET cancelled = ?2 WHERE id = ?1 AND ${OPEN}`).bind(request.id, now),
		db.prepare("SELECT slot_start FROM requests WHERE id = ?").bind(request.id),
	]);
	if (cancelled.meta.changes !== 1) return;
	await clear(env, released.results as StrayEvent[]);
	const time = timeOf(env, current.results[0] as Pick<RequestRow, "slot_start">);
	await send(env, [
		...offers.map((offer) => notices.withdrawn(intake, time, offer.email)),
		notices.withdrawn(intake, time, env.MAIL_TO),
		notices.cancelled(intake, time),
	]);
}

type Moved = "moved" | "closed" | "unchanged";

// To another open time, read from the calendars now with the same rules and lead time as the form.
// `from` is the time the list of times showed, so a list left open across another move or an
// approval changes nothing.
async function move(env: Env, loaded: Loaded, start: number, from: number, origin: string): Promise<Moved> {
	const { request, offers, intake } = loaded;
	if (!changeable(request) || from !== request.slot_start) return "unchanged";
	if (!Number.isFinite(start) || start === request.slot_start) return "closed";
	const end = Math.min(start + env.SLOT_MINUTES * 60_000, horizon(Date.now(), env.MONTHS_AHEAD, env.TIME_ZONE));
	if (end <= start) return "closed";
	const techs = takers(loaded).map((offer) => ({ name: offer.name, calendarId: offer.calendar_id, email: offer.email }));
	if (techs.length === 0) return "closed";
	const token = await accessToken(env.GOOGLE_SERVICE_ACCOUNT);
	const slot = (await findSlots(env, token, techs, start, end)).find((s) => s.start === start);
	if (!slot) return "closed";

	const placed = await place(env, token, loaded, slot, origin);
	const placedEvents = [...placed].map(([offer, event_id]) => ({ calendar_id: offer.calendar_id, event_id }));
	const db = env.DB;
	const params = [request.id, Date.now(), request.status, from];
	let results;
	try {
		results = await db.batch([
			...release(db, UNMOVED, params, request.status === "pending"),
			...[...placed].map(([offer, event]) =>
				db.prepare(`UPDATE offers SET hold_id = ?5 WHERE token = ?6 AND ${UNMOVED}`).bind(...params, event, offer.token),
			),
			// Last, since the guard reads the time this changes.
			db.prepare(`UPDATE requests SET slot_start = ?5, slot_end = ?6 WHERE id = ?1 AND ${UNMOVED}`).bind(...params, slot.start, slot.end),
		]);
	} catch (error) {
		await clear(env, placedEvents);
		throw error;
	}
	if (results.at(-1)!.meta.changes !== 1) {
		// Something else won: an approval, a cancel, the time passing, or this move in another tab.
		await clear(env, placedEvents);
		return "unchanged";
	}
	await clear(env, results[0].results as StrayEvent[]);

	// Told only while it still stands as moved. An approval at the new time since tells everyone
	// itself, and a cancel does too.
	const stands = await db
		.prepare("SELECT 1 FROM requests WHERE id = ? AND status = ? AND slot_start = ? AND cancelled IS NULL")
		.bind(request.id, request.status, slot.start)
		.first()
		.catch((error) => (console.error(error), true));
	if (!stands) return "moved";
	const [was, time] = [timeOf(env, request), formatTime(slot.start, env.TIME_ZONE)];
	const link = customerLink(origin, request)!;
	if (request.status === "confirmed") {
		const approver = offers.find((offer) => offer.token === request.confirmed_by)!.name;
		await send(env, [
			...[...offers.map((offer) => offer.email), env.MAIL_TO].map((to) => notices.moved(intake, was, time, to, notices.movedBooked(approver))),
			notices.rescheduled(intake, time, approver, link),
		]);
	} else {
		const offered = offers.map((offer) => ({ name: offer.name, email: offer.email, link: offerLink(origin, offer), held: placed.has(offer) }));
		await send(env, [
			...offered.map((tech) => notices.moved(intake, was, time, tech.email, notices.movedOpen(tech))),
			notices.moved(intake, was, time, env.MAIL_TO, notices.movedRecord(offered)),
			notices.rescheduled(intake, time, null, link),
		]);
	}
	return "moved";
}

// The buttons. Returns where to send them next: back to the page, which shows where it stands now,
// or to the list of times when the one they picked can't be had.
export async function act(env: Env, token: string, form: FormData | null, origin: string, ip: string | null): Promise<string> {
	const here = `/requests/${token}`;
	const loaded = await load(env.DB, token);
	if (!loaded) return here;
	const action = String(form?.get("action") ?? "");
	if (action === "cancel") await cancel(env, loaded);
	if (action === "move") {
		// Each move reads the calendars and emails every tech, so it's limited like the form.
		const { success } = await env.REQUEST_LIMITER.limit({ key: ip ?? "unknown" });
		if (!success) {
			console.warn("rate limited a move");
			return `${here}/times?busy`;
		}
		const moved = await move(env, loaded, Number(form?.get("slot")), Number(form?.get("from")), origin);
		if (moved === "closed") return `${here}/times?closed`;
	}
	return here;
}

const notFound = () => message("Request not found", "This link doesn't match a request.", 404);

// What their link says for where the request stands, and whether they can still change it.
function view({ request, offers }: Loaded, time: string): [string, string] {
	if (request.cancelled !== null) return ["You cancelled this request", "We've let our techs know. Send the form again any time to book another drop-off."];
	if (request.status === "declined") return ["None of our techs can make that time", "Sorry about that. Send the form again with another time, or reply to our email."];
	if (request.status === "expired") return ["None of our techs could confirm that time", "Sorry about that. Send the form again with another time, or reply to our email."];
	if (request.done !== null) return ["Your repair is done", "Thanks! Reply to our email if anything's not right."];
	if (request.slot_start <= Date.now()) {
		return request.status === "confirmed"
			? ["Your drop-off time has passed", "To change anything now, reply to our email."]
			: ["Your drop-off time has passed", "None of our techs confirmed it in time; we'll email you. Reply to our email to find another time."];
	}
	if (request.status === "confirmed") {
		const tech = offers.find((offer) => offer.token === request.confirmed_by)?.name ?? "A tech";
		return ["Your drop-off is confirmed", `${tech} will be there for it. Drop off your device on ${stop(time)}`];
	}
	return ["Waiting for a tech to confirm", `We'll email you when one of our techs confirms your drop-off for ${stop(time)} Nothing is booked until then.`];
}

// How far along a request still on its way is: sent, then confirmed, then done. One that ended
// another way has its page say so, and shows none.
function progress(request: RequestRow) {
	const closed = request.cancelled !== null || request.no_show !== null || request.status === "declined" || request.status === "expired";
	if (closed || (request.status === "pending" && request.slot_start <= Date.now())) return "";
	const reached = request.done !== null ? 2 : request.status === "confirmed" ? 1 : 0;
	const steps = ["Sent", "Confirmed", "Done"].map(
		(step, i) => `<li${i <= reached ? ' class="reached"' : ""}${i === reached ? ' aria-current="step"' : ""}>${step}</li>`,
	);
	return `<ol class="progress" aria-label="Where your request is">${steps.join("")}</ol>\n`;
}

export async function page(env: Env, token: string): Promise<Response> {
	const loaded = await load(env.DB, token);
	if (!loaded) return notFound();
	const { request, intake } = loaded;
	const time = timeOf(env, request);
	const [title, state] = view(loaded, time);
	const actions = changeable(request)
		? `<div class="actions"><a class="button primary" href="/requests/${token}/times">Change the time</a>
<form method="post"><button name="action" value="cancel">Cancel my drop-off</button></form></div>
<p class="note">Cancelling can't be undone; send the form again to book another time.</p>`
		: `<div class="actions"><a class="button primary" href="${escape(env.SITE_URL)}/request/">Send the form again</a></div>`;
	return html(
		title,
		`<p class="eyebrow">Your repair request</p>
<h1>${escape(title)}</h1>
<p class="state">${escape(state)}</p>
${progress(request)}${actions}
${details("What you sent us", intake, time)}`,
	);
}

const dayFormat = zonedFormat("en-CA", { weekday: "long", month: "long", day: "numeric" });
const weekdayFormat = zonedFormat("en-CA", { weekday: "short" });
const dateFormat = zonedFormat("en-CA", { day: "numeric" });
const shortMonthFormat = zonedFormat("en-CA", { month: "short" });
const hourFormat = zonedFormat("en-CA", { hour: "numeric", minute: "2-digit" });
const monthFormat = zonedFormat("en-CA", { year: "numeric", month: "2-digit" });

// The months of the booking window after the form's row of days, as links to their times, with the
// one showing marked.
function months(env: Env, now: number, showing: string | null) {
	const [year, month] = monthFormat(env.TIME_ZONE).format(now).split("-").map(Number);
	return Array.from({ length: env.MONTHS_AHEAD }, (_, i) => {
		const middle = Date.UTC(year, month - 1 + i, 15);
		const value = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit" }).format(middle);
		const label = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "short" }).format(middle);
		return `<a href="?month=${value}"${value === showing ? ' aria-current="page"' : ""}>${escape(label)}</a>`;
	});
}

// The open times to move to: the form's row of days, or with ?month=YYYY-MM that month. GET, so it
// only shows them; picking one POSTs back to the request.
export async function times(env: Env, token: string, params: URLSearchParams, ip: string | null): Promise<Response> {
	const loaded = await load(env.DB, token);
	if (!loaded) return notFound();
	const { request } = loaded;
	// Nothing to pick any more; the request's page says why.
	if (!changeable(request)) return new Response(null, { status: 303, headers: { Location: `/requests/${token}` } });
	// Each look reads the calendars, as /slots does, so it's limited the same way.
	const { success } = await env.SLOTS_LIMITER.limit({ key: ip ?? "unknown" });
	if (!success) {
		console.warn("rate limited a customer's times");
		return message("Too many tries", "Wait a minute, then reload this page.", 429);
	}
	const now = Date.now();
	const month = params.get("month");
	const window = month === null ? { from: now, to: rowEnd(now, env.DAYS_AHEAD, env.TIME_ZONE) } : monthWindow(month, now, env.MONTHS_AHEAD, env.TIME_ZONE);
	if (!window) return message("No such month", "Pick one of the months on the list of times.", 400);
	const techs = takers(loaded).map((offer) => ({ name: offer.name, calendarId: offer.calendar_id, email: offer.email }));
	const open = techs.length === 0 ? [] : (await findSlots(env, await accessToken(env.GOOGLE_SERVICE_ACCOUNT), techs, window.from, window.to)).filter((slot) => slot.start !== request.slot_start);

	// Each day with open times: its button in the row, and a form with its times. Picking a day
	// shows its form, by the rule for its button in the <style> below.
	const days = new Map<string, Slot[]>();
	for (const slot of open) {
		const day = dayFormat(env.TIME_ZONE).format(slot.start);
		days.set(day, [...(days.get(day) ?? []), slot]);
	}
	const picker = [...days].map(([day, slots], i) => {
		const first = slots[0].start;
		const button = `<label class="day"><input type="radio" name="day" id="day-${i}"${i === 0 ? " checked" : ""} aria-label="${escape(day)}">
<span class="weekday">${escape(weekdayFormat(env.TIME_ZONE).format(first))}</span><span class="date">${escape(dateFormat(env.TIME_ZONE).format(first))}</span><span class="month">${escape(shortMonthFormat(env.TIME_ZONE).format(first))}</span></label>`;
		const choices = slots.map(
			(slot) => `<label><input type="radio" name="slot" value="${slot.start}" required> ${escape(hourFormat(env.TIME_ZONE).format(slot.start))}</label>`,
		);
		const form = `<form method="post" action="/requests/${token}" class="panel" id="panel-${i}">
<input type="hidden" name="action" value="move">
<input type="hidden" name="from" value="${request.slot_start}">
<p class="picked" id="picked-${i}">${escape(day)}</p>
<div class="times" role="radiogroup" aria-labelledby="picked-${i}">
${choices.join("\n")}
</div>
<button class="primary">Move my drop-off</button>
</form>`;
		return { button, form, rule: `.picker:has(#day-${i}:checked) #panel-${i} { display: grid; }` };
	});
	const notes = [
		...(params.has("closed") ? ["That time isn't open any more. Pick another."] : []),
		...(params.has("busy") ? ["Too many tries just now. Wait a minute, then pick a time again."] : []),
	];
	const confirmed = request.status === "confirmed";
	const ranges = [`<a href="/requests/${token}/times"${month === null ? ' aria-current="page"' : ""}>Next few weeks</a>`, ...months(env, now, month)];
	return html(
		"Change your drop-off time",
		`<p class="eyebrow">Your repair request</p>
<h1>Change your drop-off time</h1>
<p class="state">It's now ${escape(stop(timeOf(env, request)))} ${
			confirmed
				? "Times here are when the tech who confirmed it can take it, so it stays confirmed."
				: "Moving it asks our techs again, and we'll email you when one confirms the new time."
		}</p>
${notes.map((note) => `<p class="notice" role="alert">${escape(note)}</p>`).join("\n")}
<section class="card picker">
<h2>New drop-off time</h2>
<nav class="months" aria-label="Months">${ranges.join("")}</nav>
${
	picker.length > 0
		? `<style>${picker.map((day) => day.rule).join("\n")}</style>
<div class="days" role="radiogroup" aria-label="Days">
${picker.map((day) => day.button).join("\n")}
</div>
${picker.map((day) => day.form).join("\n")}`
		: `<p>No open times ${month === null ? "in the next few weeks" : "that month"}. Try another month, or reply to our email.</p>`
}
</section>
<p class="mine"><a href="/requests/${token}">Back to your request</a></p>`,
	);
}
