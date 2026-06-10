/**
 * Shared onboarding geometry — the dimensions that make consecutive
 * onboarding screens read as frames of one continuous shot.
 *
 * The intro ends with the user's cursor on the BEGIN key; SystemCheck
 * opens with the CONTINUE key dormant in the same slot, and both stand
 * on the same plinth/document column. Keeping these Tailwind class
 * strings single-sourced is what makes "page two of the same document"
 * survive window resizing instead of being a per-screen approximation.
 *
 * Values are the shipped Countersign intro geometry — change them here
 * and every onboarding screen moves together.
 */

/** The 208×44 key slot (BEGIN on intro, CONTINUE on SystemCheck). */
export const ONBOARDING_KEY_SLOT_CLASS = "h-11 w-52";

/** The plinth / document column width both screens are built on. */
export const ONBOARDING_COLUMN_CLASS = "w-[clamp(280px,42vw,560px)]";
