const noop = (): void => undefined

export const datadogLogs = {
  init: noop,
  logger: {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  },
}
