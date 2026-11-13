// A request offered to each tech. Their link opens a page that shows the request and lets them
// approve its drop-off time or decline it, and mark the repair done once it's approved. The page
// only shows it; the buttons POST, because mail scanners open the links in emails and must not
// approve requests by doing so.
// Each link also opens the repair queue the techs share: every approved repair not marked done.

import { clear, sweep } from "./calendar.ts";
import { type Mail, sendMail } from "./fastmail.ts";
import { accessToken, bookEvent, createEvent, deleteEvent } from "./google.ts";
import { describe, dialable, formatTime, type Intake, sameDayFee, stop, what } from "./intake.ts";
import * as notices from "./notices.ts";
import { escape, html } from "./pages.ts";
import { parseTechs } from "./techs.ts";

export interface RequestRow {
	id: string;
	intake: string;
	// Nullable in the schema (0003 says why), but every request has a time. The customer can move
	// it (customer.ts), so it's the time to go by, not the one in `intake`.
	slot_start: number;
	slot_end: number;
	// A cancelled request keeps the status it had; `cancelled` is what closes it (0006 says why).
	status: "pending" | "confirmed" | "declined" | "expired";
	confirmed_by: string | null; // the offer token of the tech who approved the drop-off
	rush: number; // the fee, 0 for none
	done: number | null; // when a tech marked it done
	done_by: string | null; // the offer token of that tech; null for ones done before 0005
	customer_token: string | null; // the customer's link; null for requests from before 0006
	cancelled: number | null; // when the customer cancelled it
}

export interface OfferRow {
	token: string;
	request_id: string;
	name: string;
	email: string;
	calendar_id: string;
	hold_id: string | null;
	declined: number;
}

async function load(db: D1Database, token: string) {
	const offer = await db.prepare("SELECT * FROM offers WHERE token = ?").bind(token).first<OfferRow>();
	if (!offer) return null;
	const request = await db.prepare("SELECT * FROM requests WHERE id = ?").bind(offer.request_id).first<RequestRow>();
	if (!request) return null;
	const { results: offers } = await db
		.prepare("SELECT * FROM offers WHERE request_id = ? ORDER BY position")
		.bind(request.id)
		.all<OfferRow>();
	const intake: Intake = JSON.parse(request.intake);
	return { offer, request, offers, intake };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

export const timeOf = (env: Env, request: Pick<RequestRow, "slot_start">) => formatTime(request.slot_start, env.TIME_ZONE);

export const customerLink = (origin: string, request: Pick<RequestRow, "customer_token">) =>
	request.customer_token ? `${origin}/requests/${request.customer_token}` : null;

export const send = async (env: Env, mails: Omit<Mail, "from">[]) => {
	try {
		await sendMail(env.FASTMAIL_TOKEN, mails.map((mail) => ({ from: env.MAIL_FROM, ...mail })));
	} catch (error) {
		// The request is settled either way; the calendar and this page show where it stands.
		console.error(error);
	}
};

// Deletes a hold from the tech's calendar, then forgets it. The hourly job looks for strays by a
// hold_id that's still set, so the two go together: a hold that's gone must not keep its id, or
// the job keeps trying to delete it and the request is never cleaned up. If the delete throws,
// the id stays and the job tries again. Meant for a hold that can't become the booking any more:
// another tech's once one has approved, or any hold of a settled request. Nothing here stops the
// delete, so a hold its tech could still approve goes through `dropHold` instead. Only that hold
// is forgotten: a customer moving the drop-off may have put a new one on the offer meanwhile.
async function forgetHold(env: Env, token: string, offer: OfferRow) {
	await deleteEvent(token, offer.calendar_id, offer.hold_id!);
	await env.DB.prepare("UPDATE offers SET hold_id = NULL WHERE token = ? AND hold_id = ?").bind(offer.token, offer.hold_id).run();
}

// The same for a declined tech's hold, the other way round: forgotten first, then deleted. Both
// `decline` and the hourly job, which finds the ones whose delete failed, come through here. The
// tech can approve it after all at any moment, and deleting first could delete the hold just after
// that approve turned it into the booking. So the hold is taken off the offer in one statement,
// only while they're still declined, and `confirm` reads the hold in the batch that undoes the
// decline: whichever runs first, the other sees it, and the event deleted here is never one an
// approve books. If the delete throws, the id goes back so the hourly job tries again, but only
// while they're still declined and nothing else is on the offer: had they approved it meanwhile,
// or the customer moved it (which asks every tech again and puts new holds on), the old hold would
// pass for the booking or a hold at the new time. Then it goes to stray_events instead, which the
// hourly job also clears. Should that fail too, the hold stays on their calendar with no record of
// it, for them to delete by hand.
async function dropHold(env: Env, offer: OfferRow) {
	const forgotten = await env.DB.prepare("UPDATE offers SET hold_id = NULL WHERE token = ? AND hold_id = ? AND declined = 1")
		.bind(offer.token, offer.hold_id)
		.run();
	if (forgotten.meta.changes !== 1) return;
	try {
		await deleteEvent(await accessToken(env.GOOGLE_SERVICE_ACCOUNT), offer.calendar_id, offer.hold_id!);
	} catch (error) {
		const back = await env.DB.prepare("UPDATE offers SET hold_id = ? WHERE token = ? AND hold_id IS NULL AND declined = 1")
			.bind(offer.hold_id, offer.token)
			.run();
		if (back.meta.changes !== 1) {
			await env.DB.prepare("INSERT OR IGNORE INTO stray_events (calendar_id, event_id) VALUES (?, ?)")
				.bind(offer.calendar_id, offer.hold_id)
				.run();
		}
		throw error;
	}
}

// Once the time has started nobody can approve it; the scheduled job expires it.
const passed = (request: RequestRow, now = Date.now()) => request.slot_start <= now;

// First tech to get here approves the drop-off, and the device comes to them then: one statement,
// so two techs pressing at once can't both win. Only the drop-off; the repair goes in the queue
// for any tech. A tech who declined can still change their mind while it's open. Other repairs at
// the same time don't stop them: it's a drop-off time, and any number of devices can come in then.
// `at` is the drop-off time the tech's page showed, when it sent one: had the customer moved it
// since, the tech would be approving a time they haven't seen, so nothing happens and their page
// shows the new one.
async function confirm(env: Env, { offer, request, offers, intake }: Loaded, origin: string, at: number | null) {
	const won = await env.DB.prepare(
		`UPDATE requests SET status = 'confirmed', confirmed_by = ?2
		 WHERE id = ?1 AND status = 'pending' AND cancelled IS NULL AND slot_start > ?3 AND (?4 IS NULL OR slot_start = ?4)`,
	)
		.bind(request.id, offer.token, Date.now(), at)
		.run();
	if (won.meta.changes !== 1) return;
	// The hold as it is now, not as loaded: a decline of theirs in another tab may have forgotten
	// it since and be about to delete it (see `dropHold`), and it mustn't be booked then. And whether
	// they were declined just now, not as loaded, for the same reason: that decline is what a failed
	// booking has to put back. RETURNING only gives the row as it is after the update, so the read
	// is a statement of its own, and the batch is one transaction: no decline gets between the two.
	// The time and the other techs' holds are read now too: the customer may have moved the drop-off
	// after this page loaded, which put new holds on at the new time, and nothing moves an open
	// request once it's approved.
	const [before, , current, others] = await env.DB.batch([
		env.DB.prepare("SELECT hold_id, declined FROM offers WHERE token = ?").bind(offer.token),
		env.DB.prepare("UPDATE offers SET declined = 0 WHERE token = ?").bind(offer.token),
		env.DB.prepare("SELECT slot_start, slot_end, customer_token FROM requests WHERE id = ?").bind(request.id),
		env.DB.prepare("SELECT * FROM offers WHERE request_id = ? AND token != ? AND hold_id IS NOT NULL").bind(request.id, offer.token),
	]);
	const mine = before.results[0] as Pick<OfferRow, "hold_id" | "declined"> | undefined;
	const holdId = mine?.hold_id ?? null;
	const now = current.results[0] as Pick<RequestRow, "slot_start" | "slot_end" | "customer_token">;

	const time = timeOf(env, now);
	// Their hold becomes the booking, or they get a new one if they weren't free when it came
	// in, had declined, or deleted the hold.
	let token: string;
	let booked: string;
	try {
		token = await accessToken(env.GOOGLE_SERVICE_ACCOUNT);
		const booking = {
			summary: notices.bookedSummary(intake),
			description: notices.bookedDescription(intake, time, offer.name, env.DROPOFF_ADDRESS),
			start: now.slot_start,
			end: now.slot_end,
			timeZone: env.TIME_ZONE,
		};
		booked =
			holdId && (await bookEvent(token, offer.calendar_id, holdId, booking))
				? holdId
				: await createEvent(token, offer.calendar_id, booking, true);
	} catch (error) {
		// Not on their calendar, so nobody has it yet: open it again before anyone is told, and the
		// error page tells the tech to try again. It also says nothing changed, so a tech who had
		// declined goes back to declined: left counted as open, the last other tech declining would
		// never settle the request, and the customer would hear nothing until it expired. Nothing
		// has declined for them since the read above, since `decline` only works on an open request.
		await env.DB.batch([
			env.DB.prepare("UPDATE requests SET status = 'pending', confirmed_by = NULL WHERE id = ? AND confirmed_by = ?")
				.bind(request.id, offer.token),
			env.DB.prepare("UPDATE offers SET declined = ? WHERE token = ?").bind(mine?.declined ?? 0, offer.token),
		]);
		throw error;
	}

	// The booking's id goes on their offer, where a cancel or a move from the customer's link finds
	// it. A hold that became the booking has it there already; a new one doesn't yet. Only while
	// it's still theirs at that time, though: a customer who cancelled or moved it meanwhile took
	// whatever was on the offer then, and has told everyone. Nothing would point at this booking, so
	// it goes, and nobody hears of an approval that no longer stands.
	const kept = await env.DB.prepare(
		`UPDATE offers SET hold_id = ?1 WHERE token = ?2
		 AND EXISTS (SELECT 1 FROM requests WHERE id = ?3 AND confirmed_by = ?2 AND cancelled IS NULL AND slot_start = ?4)`,
	)
		.bind(booked, offer.token, request.id, now.slot_start)
		.run();
	if (kept.meta.changes !== 1) {
		await clear(env, [{ calendar_id: offer.calendar_id, event_id: booked }]);
		return;
	}

	// Everyone else's hold goes. One that can't be deleted keeps its id, and the hourly job tries again.
	const results = await Promise.allSettled((others.results as OfferRow[]).map((other) => forgetHold(env, token, other)));
	for (const result of results) if (result.status === "rejected") console.error(result.reason);

	// Every other tech hears, those who declined the drop-off too: the repair is in their queue now.
	await send(env, [
		notices.confirmed(intake, time, offer.name, env.DROPOFF_ADDRESS, customerLink(origin, now)),
		...offers
			.filter((other) => other.token !== offer.token)
			.map((other) => notices.taken(intake, time, other.email, offer.name, env.DROPOFF_ADDRESS)),
		notices.taken(intake, time, env.MAIL_TO, offer.name, env.DROPOFF_ADDRESS),
	]);
}

// Takes only this tech out. Once nobody's left, the customer hears it's a no.
async function decline(env: Env, { offer, request, intake }: Loaded) {
	if (request.status !== "pending" || request.cancelled !== null) return;
	// Checked again here, not only on what was loaded: had they just approved it in another tab,
	// they aren't out, and their hold is now the booking. And had the customer cancelled it, it's
	// closed already, and declining it would tell them nobody could take it.
	const changed = await env.DB.prepare(
		`UPDATE offers SET declined = 1 WHERE token = ?1 AND declined = 0
		 AND EXISTS (SELECT 1 FROM requests WHERE id = ?2 AND status = 'pending' AND cancelled IS NULL)`,
	)
		.bind(offer.token, request.id)
		.run();
	if (changed.meta.changes !== 1) return;
	if (offer.hold_id) {
		try {
			await dropHold(env, offer);
		} catch (error) {
			// Still on their calendar; the hourly job tries again.
			console.error(error);
		}
	}

	const ended = await env.DB.prepare(
		`UPDATE requests SET status = 'declined' WHERE id = ?1 AND status = 'pending' AND cancelled IS NULL
		 AND NOT EXISTS (SELECT 1 FROM offers WHERE request_id = ?1 AND declined = 0)`,
	)
		.bind(request.id)
		.run();
	if (ended.meta.changes !== 1) return;
	const time = timeOf(env, request);
	await send(env, [notices.declined(intake, time), notices.nobody(intake, time, env.MAIL_TO)]);
}

// Out of the queue once it's back with the customer. Approving only settled the drop-off, so any
// tech with a link to it may have done the repair, one who declined the drop-off too. Only once,
// so it keeps the first tech who said so.
async function finish(env: Env, { offer, request }: Loaded) {
	await env.DB.prepare(
		"UPDATE requests SET done = ?3, done_by = ?2 WHERE id = ?1 AND status = 'confirmed' AND cancelled IS NULL AND done IS NULL",
	)
		.bind(request.id, offer.token, Date.now())
		.run();
}

// A hold still on a tech's calendar that isn't the booking. The hourly job deletes these, and keeps
// a request while it has one, so both of its queries must mean the same thing by it. A constant,
// never anything a request sent, so it's safe to put in the SQL as it is. A cancelled request has
// no booking: a cancel takes every event off the offers at once, so one here was put back by a
// race (see `dropHold`) and goes too.
const NOT_BOOKING =
	"offers.hold_id IS NOT NULL AND (offers.token IS NOT requests.confirmed_by OR requests.cancelled IS NOT NULL)";

// Run by the cron in wrangler.jsonc. Closes the requests nobody approved in time and tells the
// customer, then deletes the holds nobody needs any more: a declined tech's, and every hold but
// the booking once a request is settled. Holds whose delete failed earlier are among them, and so
// are the events a cancel or a move left in stray_events. Last, it deletes the customer's details
// once a request is settled and RETENTION_DAYS past its time.
export async function expire(env: Env, now = Date.now()): Promise<void> {
	// A cancelled request is closed already, and its customer told.
	const { results: expired } = await env.DB.prepare(
		`UPDATE requests SET status = 'expired'
		 WHERE status = 'pending' AND cancelled IS NULL AND slot_start <= ?1
		 RETURNING *`,
	)
		.bind(now)
		.all<RequestRow>();
	if (expired.length > 0) {
		await send(
			env,
			expired.flatMap((request) => {
				const intake: Intake = JSON.parse(request.intake);
				const time = timeOf(env, request);
				return [notices.expired(intake, time), notices.unclaimed(intake, time, env.MAIL_TO)];
			}),
		);
	}

	const { results: strays } = await env.DB.prepare(
		`SELECT offers.* FROM offers JOIN requests ON requests.id = offers.request_id
		 WHERE ${NOT_BOOKING}
		 AND (offers.declined = 1 OR requests.status != 'pending' OR requests.cancelled IS NOT NULL)`,
	).all<OfferRow>();
	// Without Google the holds wait for the next run, but the retention delete below still runs.
	const token = strays.length > 0 ? await accessToken(env.GOOGLE_SERVICE_ACCOUNT).catch((error) => console.error(error)) : undefined;
	if (token) {
		for (const offer of strays) {
			try {
				// A declined tech may be approving it after all right now; nobody else's hold here
				// is on a request still open to approve.
				await (offer.declined ? dropHold(env, offer) : forgetHold(env, token, offer));
			} catch (error) {
				// Still on the calendar; the next run tries again.
				console.error(error);
			}
		}
	}
	// Events nothing points at any more. Google sign-in failing only leaves them for the next run.
	await sweep(env);

	// Settled: nobody approved it, the customer cancelled it, or it's back with them. A repair still
	// in the queue stays however old it is, and so does one with a hold still to delete, since its
	// offer is the only record of the hold. Offers first, since they point at the request.
	const settled = `SELECT id FROM requests WHERE slot_start < ?1
		AND (status IN ('declined', 'expired') OR cancelled IS NOT NULL OR done IS NOT NULL)
		AND NOT EXISTS (SELECT 1 FROM offers WHERE offers.request_id = requests.id
			AND ${NOT_BOOKING})`;
	const cutoff = now - env.RETENTION_DAYS * 86_400_000;
	await env.DB.batch([
		env.DB.prepare(`DELETE FROM offers WHERE request_id IN (${settled})`).bind(cutoff),
		env.DB.prepare(`DELETE FROM requests WHERE id IN (${settled})`).bind(cutoff),
	]);
}

// `origin` is the worker's own, for the customer's link in the emails; `at` the drop-off time the
// page showed, when the form sent one.
export async function act(env: Env, token: string, action: string, origin: string, at: number | null): Promise<void> {
	const loaded = await load(env.DB, token);
	if (!loaded) return;
	if (action === "confirm") await confirm(env, loaded, origin, at);
	if (action === "decline") await decline(env, loaded);
	if (action === "done") await finish(env, loaded);
}

// What a tech's link says, and the buttons it offers, for where the request stands.
function view({ offer, request, offers, intake }: Loaded, time: string): [string, string, string] {
	// The tech behind an offer token, as "You" on their own page.
	const who = (token: string | null) =>
		token === offer.token ? "You" : (offers.find((other) => other.token === token)?.name ?? "Another tech");
	const approve = '<button name="action" value="confirm">Approve drop-off</button>';
	if (request.cancelled !== null) {
		return ["The customer cancelled this request", "Any hold or booking for it is off the calendars, and it's out of the queue.", ""];
	}
	if (request.status === "confirmed") {
		const approved = `${who(request.confirmed_by)} approved the drop-off`;
		if (request.done !== null) {
			// Before done_by, only the approver could mark it done.
			const finisher = who(request.done_by ?? request.confirmed_by);
			return [`${finisher} finished this repair`, `${approved}, and it's out of the queue.`, ""];
		}
		return [
			approved,
			"The customer has been told, and it's in the repair queue for any tech to pick up. Whoever does the repair agrees with them when it'll be ready, and marks it done once it's back with them.",
			'<button name="action" value="done">Mark done</button>',
		];
	}
	if (request.status === "declined") return ["Every tech declined this request", "The customer has been told.", ""];
	if (request.status === "expired") return ["This request expired", "Nobody approved the drop-off in time, and the customer has been told.", ""];
	if (passed(request)) return ["This time has passed", "Nobody approved the drop-off in time, so it can't be approved now.", ""];
	if (offer.declined) return ["You declined this request", "It's still open for the others, so you can approve the drop-off after all.", approve];
	return [
		intake.rush ? "New same-day repair request" : "New repair request",
		`Drop-off ${stop(time)} The first tech to approve gets the drop-off, and the repair goes in the queue for any tech to pick up.`,
		approve + '<button name="action" value="decline">Decline</button>',
	];
}

export async function page(env: Env, token: string): Promise<Response> {
	const loaded = await load(env.DB, token);
	if (!loaded) return html("Request not found", "<h1>Request not found</h1><p>This link doesn't match a request.</p>", 404);
	const { offer, request, intake } = loaded;
	const time = timeOf(env, request);

	const [title, state, buttons] = view(loaded, time);

	// Payment is in person, so the fee is only a reminder.
	const rush = intake.rush
		? `<p class="rush">SAME-DAY: +${sameDayFee(intake)}, paid in person. It goes to the front of the queue.</p>\n`
		: "";
	// Techs call to talk through the price, so the number, when they gave one, is one tap away on a
	// phone.
	const call = intake.phone
		? `<p class="call"><a href="tel:${escape(dialable(intake.phone))}">Call ${escape(intake.name)}: ${escape(intake.phone)}</a></p>\n`
		: "";
	// Once approved, the customer has been sent the address, so the page shows the same line, and
	// any tech can tell what they were told. It's escaped like the rest, though it's our own secret.
	const address =
		request.status === "confirmed" ? `<p class="address">${escape(notices.dropOff(env.DROPOFF_ADDRESS))}</p>\n` : "";
	return html(
		title,
		`<h1>${escape(title)}</h1>
<p class="state">${escape(state)}</p>
${rush}${address}${call}<pre>${escape(describe(intake, time))}</pre>
${buttons && `<form method="post"><input type="hidden" name="at" value="${request.slot_start}">${buttons}</form>`}
<p class="mine"><a href="/offers/${offer.token}/queue">Repair queue</a></p>`,
	);
}

// One queue for every tech: each approved repair nobody has marked done, whoever approved it, in
// the order to work them: same-day first (the `rush` column), then the earliest drop-off, then the
// first filed. `rush > 0`, not `rush`: same-day is same-day whatever fee it was quoted at. Each has who approved it, and the
// viewing tech's own offer for it, so what they press there is recorded as them. A tech is their
// calendar, as everywhere else a request meets one; one added to TECHS since it came in has none.
// One the customer cancelled isn't coming in.
const QUEUE_SQL = `SELECT requests.*,
	(SELECT name FROM offers WHERE token = requests.confirmed_by) AS approver,
	(SELECT token FROM offers WHERE request_id = requests.id AND calendar_id = ?1 ORDER BY position LIMIT 1) AS mine
	FROM requests WHERE status = 'confirmed' AND done IS NULL AND cancelled IS NULL
	ORDER BY rush > 0 DESC, slot_start, created`;

type Queued = RequestRow & { approver: string | null; mine: string | null };

export async function queue(env: Env, token: string): Promise<Response> {
	const offer = await env.DB.prepare("SELECT * FROM offers WHERE token = ?").bind(token).first<OfferRow>();
	// Links outlive a tech's place in TECHS, and the queue shows every customer, so only a tech still
	// on the list may open it. A removed tech's old link answers like an unknown one.
	const current = offer && parseTechs(env.TECHS).some((tech) => tech.calendarId === offer.calendar_id);
	if (!offer || !current) return html("Queue not found", "<h1>Queue not found</h1><p>This link doesn't match a request.</p>", 404);
	const { results } = await env.DB.prepare(QUEUE_SQL).bind(offer.calendar_id).all<Queued>();

	const items = results.map((request) => {
		const intake: Intake = JSON.parse(request.intake);
		const time = timeOf(env, request);
		// The device too, when the title is the service, and how many sticks or the like it's for.
		const quantity = intake.quantity ? `Quantity ${intake.quantity}` : "";
		const details = [`Drop-off ${time}`, intake.service && intake.device, quantity, intake.name].filter((detail) => detail);
		const call = intake.phone
			? ` · <a href="tel:${escape(dialable(intake.phone))}">${escape(intake.phone)}</a>`
			: intake.messenger
				? " · Messenger"
				: "";
		const title = `${request.rush ? "SAME-DAY " : ""}${escape(what(intake))}`;
		const approver = request.mine === request.confirmed_by ? "you" : escape(request.approver ?? "another tech");
		// Without an offer of their own there's no page to press anything on.
		const [heading, unlinked] = request.mine
			? [`<a class="what" href="/offers/${request.mine}">${title}</a>`, ""]
			: [`<span class="what">${title}</span>`, " · No link for you: it came in before you were added"];
		return `<li>${heading}<br>
<span class="details">${details.map(escape).join(" · ")}${call}<br>
Approved by ${approver}${unlinked}</span></li>`;
	});
	const count = `${results.length} repair${results.length === 1 ? "" : "s"}`;
	return html(
		"Repair queue",
		`<h1>Repair queue</h1>
${
	items.length > 0
		? `<p class="state">${count} approved and not marked done, for any tech to pick up: same-day first, then by drop-off time. Whoever does one marks it done on its page.</p>
<ol class="queue">
${items.join("\n")}
</ol>`
		: `<p class="state">Nothing in the queue. Repairs show up here once a tech approves the drop-off, until one marks them done.</p>`
}`,
	);
}
