/** Colombian mobile number: 10 digits starting with 3. */
export const validPhone = (v: string) => /^3\d{9}$/.test(v)

/** At least first name and last name. */
export const validName = (v: string) => v.trim().split(/\s+/).filter((w) => w.length >= 2).length >= 2

/** Cédula: 6 to 10 digits. */
export const validDocument = (v: string) => /^\d{6,10}$/.test(v)

/** Stellar public key format (G + 55 base32 chars); the backend checks the checksum. */
export const validStellarAddress = (v: string) => /^G[A-Z2-7]{55}$/.test(v.trim())

export const shortAddress = (v: string) => `${v.slice(0, 6)}…${v.slice(-6)}`
