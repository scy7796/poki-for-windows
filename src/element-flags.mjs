// Only false and 0 turn an accessibility flag off; a missing flag counts as on, as it always has.
export const flagOn = value => value !== false && value !== 0;
