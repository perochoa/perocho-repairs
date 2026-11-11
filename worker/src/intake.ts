// The intake form: parsing, validation and the summary every email and event about it shows.
import { MAX_QUANTITY } from "./limits.ts";
import { zonedFormat } from "./slots.ts";

export interface Intake {
	name: string;
	email: string;
	phone: string;
	service: string;
	device: string;
	problem: string;
	slot: number; // epoch ms of the drop-off time they picked
	notes: string;
	// The same-day fee in dollars they agreed to, 0 for none (named for when it was a "rush"; the
	// stored forms and the requests table still call it that). Kept as a fee, not a flag, so a
	// later change to SAME_DAY_FEES doesn't change what earlier customers were quoted. Asked for
	// without a known service, it's the top of the range they were quoted, and rushFrom the bottom.
	rush: number;
	rushFrom?: number;
	// How many of a per-item service's items (sticks, for the TMR upgrade). Only set when the form
	// asks, so requests for other services, and ones filed before it asked, have none.
	quantity?: number;
}

export type Parsed = { ok: true; intake: Intake } | { ok: false; spam: boolean };

// Loose on purpose: catches typos and junk, not every invalid address.
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Also loose: digits with the usual separators and an optional leading +, 10 to 15 digits
// (a local number with its area code, up to an international one). Kept as they typed it.
const PHONE = /^\+?[\d\s().-]+$/;
const digits = (phone: string) => phone.replace(/\D/g, "").length;
const validPhone = (phone: string) => PHONE.test(phone) && digits(phone) >= 10 && digits(phone) <= 15;

// For a tel: link: the digits, and the + if they gave one.
export const dialable = (phone: string) => (phone.trim().startsWith("+") ? "+" : "") + phone.replace(/\D/g, "");

// The same-day fee for a service, by its title as the form sends it; for any other (or none), the
// range of them all, as the form quotes it.
function sameDayQuote(fees: Record<string, number>, service: string) {
	if (Object.hasOwn(fees, service)) return { rush: fees[service] };
	const all = Object.values(fees);
	const [from, to] = [Math.min(...all), Math.max(...all)];
	return from === to ? { rush: to } : { rush: to, rushFrom: from };
}

export function parseIntake(form: FormData, sameDayFees: Record<string, number>): Parsed {
	// Single-line unless told otherwise: CR/LF would leak into subjects and summaries.
	const field = (name: string, max: number, multiline = false) => {
		const value = form.get(name);
		if (typeof value !== "string") return "";
		return (multiline ? value : value.replace(/\s+/g, " ")).trim().slice(0, max);
	};

	// Hidden from people; bots fill it in.
	if (field("website", 200)) return { ok: false, spam: true };

	// Required: the form only sends once a time is picked.
	const slot = Date.parse(field("slot", 40));
	const fields = {
		name: field("name", 100),
		email: field("email", 200),
		phone: field("phone", 30),
		service: field("service", 150),
		device: field("device", 150),
		problem: field("problem", 2000, true),
		notes: field("notes", 2000, true),
	};

	// Sent only for a per-item service; anything but a whole number in range is a tampered form.
	const quantityField = field("quantity", 10);
	const quantity = quantityField === "" ? undefined : Number(quantityField);
	const validQuantity = quantity === undefined || (Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY);

	const valid =
		validQuantity &&
		fields.name !== "" &&
		fields.device !== "" &&
		fields.problem !== "" &&
		EMAIL.test(fields.email) &&
		validPhone(fields.phone) &&
		!Number.isNaN(slot);

	if (!valid) return { ok: false, spam: false };
	const sameDay = form.get("rush") === "1" ? sameDayQuote(sameDayFees, fields.service) : { rush: 0 };
	// Left off when there's none, so the stored form reads the same as before the form asked.
	return { ok: true, intake: { ...fields, slot, ...sameDay, ...(quantity && { quantity }) } };
}

const formatter = zonedFormat("en-CA", {
	weekday: "short",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

export const formatTime = (ms: number, timeZone: string): string => formatter(timeZone).format(ms);

// Ends a sentence on a time without doubling the period of "a.m." and "p.m.".
export const stop = (time: string) => (time.endsWith(".") ? time : `${time}.`);

export function describe(intake: Intake, time: string): string {
	const lines = [
		["Name", intake.name],
		["Email", intake.email],
		["Phone", intake.phone],
		["Service", intake.service],
		["Quantity", intake.quantity ? String(intake.quantity) : ""],
		["Device", intake.device],
		["Drop-off time", time],
		["Same-day", intake.rush ? `yes, +${sameDayFee(intake)} (paid in person)` : ""],
	]
		.filter(([, value]) => value)
		.map(([label, value]) => `${label}: ${value}`);

	lines.push("", "What's wrong:", intake.problem);
	if (intake.notes) lines.push("", "Notes:", intake.notes);
	return lines.join("\n");
}

// The same-day fee as quoted: "$10", or "$10–$20" when no service was picked. Worded like
// feeText in src/services.ts.
export const sameDayFee = ({ rush, rushFrom }: Intake) => (rushFrom ? `$${rushFrom}–$${rush}` : `$${rush}`);

// What the request is for: the chosen service, else the device.
export const what = (intake: Intake) => intake.service || intake.device;

// Leads what the techs see about a request, so a same-day one stands out in a list of emails or
// events.
export const rushed = (intake: Intake) => (intake.rush ? `SAME-DAY ${what(intake)}` : what(intake));
