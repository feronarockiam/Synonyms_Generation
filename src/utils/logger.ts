import pino from 'pino';
import path from 'path';

const logFile = path.resolve(__dirname, '../../data/pipeline.log');

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: { destination: logFile, mkdir: true }
      },
      {
        target: 'pino-pretty', // Log to console in pretty format
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        }
      }
    ]
  }
});
