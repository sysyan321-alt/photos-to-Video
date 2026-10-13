'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function write(level, scope, message, extra) {
    if (LEVELS[level] < threshold) return;
    const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${scope ? `(${scope}) ` : ''}${message}`;
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
    stream.write(extra === undefined ? `${line}\n` : `${line} ${JSON.stringify(extra)}\n`);
}

function createLogger(scope) {
    return {
        debug: (message, extra) => write('debug', scope, message, extra),
        info: (message, extra) => write('info', scope, message, extra),
        warn: (message, extra) => write('warn', scope, message, extra),
        error: (message, extra) => write('error', scope, message, extra)
    };
}

module.exports = { createLogger };
