import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, json, colorize, simple } = winston.format;

export const logger = winston.createLogger({
  level: config.isProduction ? 'info' : 'debug',
  format: config.isProduction
    ? combine(timestamp(), json())
    : combine(colorize(), timestamp(), simple()),
  defaultMeta: {
    service: 'lssw-backend',
    region: 'EU',
  },
  transports: [
    new winston.transports.Console(),
  ],
});

// Helper: mask sensitive data before logging
export function maskToken(token: string): string {
  if (!token || token.length < 8) return '***';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
}
