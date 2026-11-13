// The emails and calendar text a request produces, beyond the summary in intake.ts.

import type { Mail } from "./fastmail.ts";
import { describe, type Intake, rushed, sameDayFee, stop, what } from "./intake.ts";

export interface Offered {
	name: string;
	email: string;
	link: string;
	held: boolean;
}

type Message = Omit<Mail, "from">;

// What the techs and repairs@ see in a subject. Customers' subjects use `what` alone.
const about = (intake: Intake, time: string) => `${rushed(intake)} from ${intake.name}, ${time}`;
const subject = (intake: Intake, time: string) => `Repair request: ${about(intake, time)}`;

// The same request to every tech, each with their own link.
export const toTech = (intake: Intake, time: string, tech: Offered): Message => ({
	to: tech.email,
	replyTo: intake.email,
	subject: subject(intake, time),
	text: [
		describe(intake, time),
		"",
		`Approve the drop-off or decline it: ${tech.link}`,
		"The first tech to approve gets the drop-off, and the repair goes in the queue all the techs share, for any of you to pick up. Declining only takes you out of the drop-off; the others can still approve it.",
		...(intake.rush ? ["It's same-day: once approved, it goes to the front of the queue."] : []),
		...(tech.held ? ["It's on your calendar as a tentative hold until someone approves it."] : []),
		"The time is when they drop it off. Call them to talk through the price and when it'll be ready, or reply to this email to reach them.",
	].join("\n"),
});

// Google shows an event's description as HTML, so a customer could hide a link of their own
// behind text like "Approve the drop-off". Lookalike brackets keep what they wrote readable without
// any tags.
const untagged = (text: string) => text.replaceAll("<", "‹").replaceAll(">", "›");

export const holdDescription = (intake: Intake, time: string, link: string) =>
	`${untagged(describe(intake, time))}\n\nApprove the drop-off or decline it: ${link}`;

// Every tech takes in devices at the same address, which is a secret (DROPOFF_ADDRESS) because the
// repo is public. The customer's confirmation gives it, and the booking, the other techs' email and
// the offer page give it in the same words, so any tech can tell what the customer was told.
export const dropOff = (address: string) => `Drop-off address: ${address}`;

export const bookedDescription = (intake: Intake, time: string, tech: string, address: string) =>
	`${untagged(describe(intake, time))}\n\n${dropOff(address)}\n\nDrop-off approved by ${tech}. The repair is in the queue for any tech to pick up; whoever does agrees with them when it'll be ready. To cancel or move the drop-off, ask the customer to use the link in their emails; deleting this event doesn't cancel it.`;

export const holdSummary = (intake: Intake) => `Request: ${rushed(intake)} (${intake.name})`;
export const bookedSummary = (intake: Intake) => `Repair: ${rushed(intake)} (${intake.name})`;

// For repairs@, which keeps a copy of everything without the links.
export const record = (intake: Intake, time: string, to: string, techs: Offered[]): Message => {
	const held = techs.filter((tech) => tech.held).map((tech) => tech.name);
	return {
		to,
		replyTo: intake.email,
		subject: subject(intake, time),
		text: [
			describe(intake, time),
			"",
			`Sent to: ${techs.map((tech) => tech.name).join(", ")}`,
			...(held.length > 0 ? [`Held on: ${held.join(", ")} (tentative)`] : []),
		].join("\n"),
	};
};

const hi = (intake: Intake) => `Hi ${intake.name},`;
// Payment is in person, so the fee is only a note.
const sameDay = (intake: Intake) =>
	intake.rush
		? [`You asked for same-day service, so your repair goes to the front of the queue. That's +${sameDayFee(intake)}${intake.rushFrom ? " depending on the device, which the tech will confirm" : ""}, paid in person with the repair.`]
		: [];
const yours = (intake: Intake, time: string) => ["", "Your request:", describe(intake, time)];
// Their own link to the request. Null for requests filed before customers had one.
const change = (link: string | null) => (link ? [`To cancel or change your drop-off time: ${link}`] : []);

export const received = (intake: Intake, time: string, link: string): Message => ({
	to: intake.email,
	subject: `We got your repair request: ${what(intake)}`,
	text: [
		hi(intake),
		"",
		`Thanks! We've passed your request on to our techs. We'll email you again when one of them confirms your drop-off for ${stop(time)} Nothing is booked until then.`,
		...sameDay(intake),
		"A tech may call you to talk through the price. Once you've dropped it off, they'll let you know when it's ready. Reply to this email if anything changes.",
		...change(link),
		...yours(intake, time),
	].join("\n"),
});

export const failed = (intake: Intake): Message => ({
	to: intake.email,
	subject: `Your repair request didn't go through: ${what(intake)}`,
	text: [
		hi(intake),
		"",
		"Something went wrong on our end, and your request wasn't sent to our techs. Please try the form again, or reply to this email with the details and we'll take it from there.",
		"",
		"Sorry about that.",
	].join("\n"),
});

// Any tech may do the repair, not only the one who approved the drop-off, so "we" say when it's ready.
export const confirmed = (
	intake: Intake,
	time: string,
	tech: string,
	address: string,
	link: string | null,
): Message => ({
	to: intake.email,
	subject: `Your repair is confirmed: ${what(intake)}, ${time}`,
	text: [
		hi(intake),
		"",
		`${tech} has confirmed your repair. Drop off your device on ${stop(time)} We'll let you know when it's ready to pick up.`,
		dropOff(address),
		...sameDay(intake),
		"Reply to this email if you need to change anything.",
		...change(link),
		...yours(intake, time),
	].join("\n"),
});

// Neither a decline nor an expiry can be booked, so the customer gets the same way out.
const turnedAway = (intake: Intake, time: string, cant: string, couldnt: string): Message => ({
	to: intake.email,
	subject: `We ${cant} take your repair request: ${what(intake)}`,
	text: [
		hi(intake),
		"",
		`Sorry, none of our techs ${couldnt} ${stop(time)} Reply to this email and we'll try to find another time, or send the form again with a different one.`,
		...yours(intake, time),
	].join("\n"),
});

export const declined = (intake: Intake, time: string): Message => turnedAway(intake, time, "can't", "can make");

export const expired = (intake: Intake, time: string): Message => turnedAway(intake, time, "couldn't", "could confirm");

// When a tech marks an approved drop-off a no-show. Rescheduling isn't something the techs do, so
// it points them back to the form for a new time, or a reply to us. Not to their own link: it only
// changes a drop-off whose time is still ahead, and this one's has passed.
export const missed = (intake: Intake, time: string, form: string): Message => ({
	to: intake.email,
	subject: `We missed you: ${what(intake)}`,
	text: [
		hi(intake),
		"",
		`We were expecting your device on ${stop(time)} It didn't reach us, so we've taken it off our list.`,
		`If you'd still like the repair, reply to this email and we'll find another time, or pick a new one with the form: ${form}`,
		...yours(intake, time),
	].join("\n"),
});

// To the other techs and repairs@, so nobody plans around the hold any more, and everyone knows the
// repair is theirs to pick up too. The address is the one the customer was sent.
export const taken = (intake: Intake, time: string, to: string, tech: string, address: string): Message => ({
	to,
	subject: `Drop-off approved by ${tech}: ${about(intake, time)}`,
	text: `${tech} approved the drop-off, so any hold for it comes off your calendar. The repair is now in the shared queue for any tech to pick up. The customer's confirmation gave them this address:\n\n${dropOff(address)}\n\n${describe(intake, time)}`,
});

const closed = (intake: Intake, time: string, to: string, subject: string, lead: string): Message => ({
	to,
	subject: `${subject}: ${about(intake, time)}`,
	text: `${lead} and the customer has been told.\n\n${describe(intake, time)}`,
});

export const nobody = (intake: Intake, time: string, to: string): Message =>
	closed(intake, time, to, "Every tech declined", "Every tech declined this request,");

export const unclaimed = (intake: Intake, time: string, to: string): Message =>
	closed(intake, time, to, "Nobody approved", "Nobody approved the drop-off in time, so it's closed");

// The customer cancelled from their link. Everyone it was offered to hears, since an open request
// waits on every tech and an approved one is in every tech's queue.
export const withdrawn = (intake: Intake, time: string, to: string): Message => ({
	to,
	subject: `Cancelled by the customer: ${about(intake, time)}`,
	text: `The customer cancelled their drop-off, so any hold or booking for it comes off your calendar, and it's out of the queue.\n\n${describe(intake, time)}`,
});

// They pressed it themselves, but an email is the record they keep, and a way to reply.
export const cancelled = (intake: Intake, time: string): Message => ({
	to: intake.email,
	subject: `You cancelled your repair request: ${what(intake)}`,
	text: [
		hi(intake),
		"",
		`We've cancelled your drop-off for ${time} and let our techs know. Send the form again any time, or reply to this email.`,
		...yours(intake, time),
	].join("\n"),
});

// The customer moved their drop-off. `next` is what happens now, for whoever reads it: their own
// link while it's open, or whose booking moved once it's approved.
export const moved = (intake: Intake, from: string, time: string, to: string, next: string[]): Message => ({
	to,
	replyTo: intake.email,
	subject: `Drop-off moved: ${about(intake, time)}`,
	text: [`The customer moved their drop-off from ${from} to ${stop(time)}`, ...next, "", describe(intake, time)].join("\n"),
});

// A new time is a new question, so a tech who couldn't make the old one is asked again.
export const movedOpen = (tech: Offered) => [
	"It's open again for every tech, those who declined the old time too.",
	`Approve the drop-off or decline it: ${tech.link}`,
	...(tech.held ? ["It's on your calendar as a tentative hold until someone approves it."] : []),
];

// For repairs@, without the links.
export const movedRecord = (techs: Offered[]) => {
	const held = techs.filter((tech) => tech.held).map((tech) => tech.name);
	return ["It's open again for every tech.", ...(held.length > 0 ? [`Held on: ${held.join(", ")} (tentative)`] : [])];
};

export const movedBooked = (tech: string) => [`It's still ${tech}'s drop-off, and the booking on their calendar moved with it.`];

export const rescheduled = (intake: Intake, time: string, tech: string | null, link: string): Message => ({
	to: intake.email,
	subject: `Your drop-off is now ${time}: ${what(intake)}`,
	text: [
		hi(intake),
		"",
		tech
			? `Your drop-off is now ${stop(time)} ${tech} will be there for it, so there's nothing more to confirm.`
			: `Your drop-off is now ${stop(time)} We'll email you again when a tech confirms it. Nothing is booked until then.`,
		...change(link),
		...yours(intake, time),
	].join("\n"),
});
