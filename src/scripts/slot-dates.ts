// The date arithmetic and grouping behind the drop-off picker (components/SlotPicker.astro). Kept
// apart from the component and free of the DOM, so `node --test` can run slot-dates.test.ts on it;
// the picker's own state (the row's last day, the months fetched so far) comes in as arguments.

// A day's times by its date; days without any aren't listed.
export type Times = Map<string, { value: string; label: string }[]>;

// Days are "YYYY-MM-DD" and months "YYYY-MM", in the worker's zone. They're formatted and
// stepped as noon UTC on that date, so neither ever shifts a day.
export const DAY = 86_400_000;
export const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
export const addDays = (day: string, n: number) => new Date(noon(day) + n * DAY).toISOString().slice(0, 10);
export const addMonths = (month: string, n: number) => {
	const [year, index] = month.split("-").map(Number);
	return new Date(Date.UTC(year, index - 1 + n, 1)).toISOString().slice(0, 7);
};
export const lastOf = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

// The page of the row a day is on. The first page starts today, whatever the weekday, and each
// after it starts seven days on, so every page shows a full week.
export const weekOf = (day: string, today: string) => Math.floor((noon(day) - noon(today)) / DAY / 7);

// The times' dates and labels are in the worker's zone, so the days match the times it offers and
// holds. en-CA writes a date as YYYY-MM-DD, which is what makes dayFormat's output a day as above.
export const dayFormat = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
export const timeFormat = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", minute: "2-digit" });

// Sorts a response's times under their days, in the order they came.
export const group = (slots: { start: string }[], day: Intl.DateTimeFormat, time: Intl.DateTimeFormat) => {
	const byDay: Times = new Map();
	for (const slot of slots) {
		const start = new Date(slot.start);
		const key = day.format(start);
		if (!byDay.has(key)) byDay.set(key, []);
		byDay.get(key)!.push({ value: slot.start, label: time.format(start) });
	}
	return byDay;
};

// A month past the row needs its own fetch; one inside it is already known. lastDay is the last
// day in the row of weeks.
export const inRow = (month: string, lastDay: string) => lastOf(month) <= lastDay;
// Whether a day's times have been read yet: the row's cover every day up to lastDay, and a day
// past it waits for its month, of which `months` holds the ones fetched so far.
export const known = (day: string, lastDay: string, rowLoaded: boolean, months: { has(month: string): boolean }) =>
	day <= lastDay ? rowLoaded : months.has(day.slice(0, 7));
