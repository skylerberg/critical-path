import { errorText } from './errors';

// A listen failure is fatal in a way the process-wide uncaughtException handler
// cannot express: that handler logs and carries on, which is right for a request
// that threw and wrong for a server that never bound. Left to it, `npm run dev`
// stays alive under --watch with no server, and a health check against the port
// answers from whatever already owns it — so the wrong build looks healthy.
export function startupFailureMessage(error: NodeJS.ErrnoException, port: number): string {
  if (error.code === 'EADDRINUSE') {
    return (
      `Port ${port} is already in use, so this server did not start. ` +
      `Stop whatever is listening there, or pick another port with PORT=<number>.`
    );
  }
  if (error.code === 'EACCES') {
    return (
      `Not permitted to bind port ${port}, so this server did not start. ` +
      `Ports below 1024 need elevated privileges; set PORT to a higher one.`
    );
  }
  return `Could not start the server on port ${port}: ${errorText(error)}`;
}
