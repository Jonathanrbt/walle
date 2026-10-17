/** API mode: simulated in the browser unless VITE_API_MOCK=0. */
export const apiMock = import.meta.env.VITE_API_MOCK !== '0'
