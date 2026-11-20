/**
 * Host half of the Question Pin bundle.
 *
 * The whole feature is Web-client UI: `client.js` registers the floating card
 * into the conversation slot tree. Nothing runs in the host, so `apply` is
 * intentionally empty — the row only has to exist so the bundle has a plugin
 * entry and the client module gets loaded.
 */

export const name = 'dsh-question-pin'

export function apply() {}