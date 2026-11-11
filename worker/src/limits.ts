// Limits the form and the worker share, imported by both so there's no copy to keep in step (like
// Outcome in outcomes.ts). Standalone, with no imports, because the site's request form imports
// it: importing intake.ts there would bring in the global Env type (through slots.ts), which the
// site's tsconfig can't resolve since it leaves out worker/.

// The most items (sticks) a request for a per-item service can be for: a few controllers' worth;
// more is a conversation. The form's quantity field stops here and intake.ts rejects more.
export const MAX_QUANTITY = 20;
