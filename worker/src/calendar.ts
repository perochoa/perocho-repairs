// What the worker does on the techs' calendars for a request, beyond the Google calls themselves:
// reading the open times, holding one, and deleting the events nothing points at any more. The
// form, the customer's link and the hourly job all come through here, so they agree on what's open
// and on how an event is let go.

import { accessToken, createEvent, deleteEvent, listEvents } from "./google.ts";
import { formatTime, type Intake } from "./intake.ts";
import * as notices from "./notices.ts";
import { openSlots, type Slot, slotOptions } from "./slots.ts";
import type { Tech } from "./techs.ts";

// The open times from now (or `from`, if later) until `to`. The calendars are only read for that
// span, so a narrow one is cheap.
export async function findSlots(env: Env, token: string, techs: Tech[], from: number, to: number): Promise<Slot[]> {
	const options = slotOptions(env, Date.now(), to);
	// A calendar that can't be read (unshared, a wrong calendarId in TECHS, or too many events to
	// read in one page) costs that tech their times, not everyone's. The log names the tech and
	// carries Google's reason, which says which; only when no calendar can be read is it an error.
	const results = await Promise.allSettled(
		techs.map((tech) => listEvents(token, tech.calendarId, Math.max(options.now, from), to)),
	);
	const events = results.map((result, i) => {
		if (result.status === "fulfilled") return result.value;
		console.error(`can't read ${techs[i].name}'s calendar; their times aren't offered. A 404 means check their calendarId in TECHS and that it's shared`, result.reason);
		return [];
	});
	if (results.every((result) => result.status === "rejected")) throw new Error("no tech's calendar could be read");
	return openSlots(events, options);
}

// A tentative hold on the tech's calendar. It's "free", so it never keeps anyone else from the time.
export const hold = (env: Env, token: string, calendarId: string, slot: Pick<Slot, "start" | "end">, intake: Intake, link: string) =>
	createEvent(token, calendarId, {
		summary: notices.holdSummary(intake),
		description: notices.holdDescription(intake, formatTime(slot.start, env.TIME_ZONE), link),
		start: slot.start,
		end: slot.end,
		timeZone: env.TIME_ZONE,
	});

export interface StrayEvent {
	calendar_id: string;
	event_id: string;
}

// Deletes events nothing points at any more: a cancelled or moved request's old ones, or one just
// made that lost a race and so never got recorded. Each is struck from stray_events once it's gone;
// one Google won't delete is put there instead (or left there, if the caller put it there first), so
// the hourly job tries again. Never throws: whatever happened to the request has happened, and the
// events are only what's left over.
export async function clear(env: Env, events: StrayEvent[]): Promise<void> {
	if (events.length === 0) return;
	let token: string;
	try {
		token = await accessToken(env.GOOGLE_SERVICE_ACCOUNT);
	} catch (error) {
		console.error(error);
		await keep(env, events);
		return;
	}
	await Promise.all(
		events.map(async (event) => {
			try {
				await deleteEvent(token, event.calendar_id, event.event_id);
				await env.DB.prepare("DELETE FROM stray_events WHERE calendar_id = ? AND event_id = ?")
					.bind(event.calendar_id, event.event_id)
					.run();
			} catch (error) {
				console.error(`stray event ${event.event_id} on ${event.calendar_id}; the hourly job tries again:`, error);
				await keep(env, [event]);
			}
		}),
	);
}

const keep = (env: Env, events: StrayEvent[]) =>
	env.DB.batch(
		events.map((event) =>
			env.DB.prepare("INSERT OR IGNORE INTO stray_events (calendar_id, event_id) VALUES (?, ?)").bind(event.calendar_id, event.event_id),
		),
	).catch((error) => console.error(`lost track of stray events, delete them by hand: ${JSON.stringify(events)}`, error));

// The hourly job's pass over stray_events: whatever couldn't be deleted at the time.
export async function sweep(env: Env): Promise<void> {
	const { results } = await env.DB.prepare("SELECT calendar_id, event_id FROM stray_events").all<StrayEvent>();
	await clear(env, results);
}
