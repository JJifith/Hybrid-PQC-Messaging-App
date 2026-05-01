import * as signalR from '@microsoft/signalr';

let connection: signalR.HubConnection | null = null;
let connectionToken: string | null = null;

export function getConnection(): signalR.HubConnection | null {
  return connection;
}

export async function startConnection(token: string): Promise<signalR.HubConnection> {
  // Reuse if already connected with the same token
  if (
    connection &&
    connectionToken === token &&
    (connection.state === signalR.HubConnectionState.Connected ||
     connection.state === signalR.HubConnectionState.Connecting ||
     connection.state === signalR.HubConnectionState.Reconnecting)
  ) {
    return connection;
  }

  // Stop existing connection if token changed
  if (connection) {
    await connection.stop().catch(() => {});
    connection = null;
  }

  connection = new signalR.HubConnectionBuilder()
    .withUrl('/hub/chat', {
      accessTokenFactory: () => token,
      // Use WebSockets first, fall back to LongPolling
      transport: signalR.HttpTransportType.WebSockets |
                 signalR.HttpTransportType.LongPolling,
      skipNegotiation: false,
    })
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (ctx) => {
        // Retry: 0ms, 2s, 5s, 10s, 30s, then every 30s
        const delays = [0, 2000, 5000, 10000, 30000];
        return delays[Math.min(ctx.previousRetryCount, delays.length - 1)];
      }
    })
    .configureLogging(signalR.LogLevel.Information)
    .build();

  // Re-register handlers after reconnect
  connection.onreconnected(() => {
    console.log('[SignalR] Reconnected');
  });

  connection.onclose((err) => {
    if (err) console.error('[SignalR] Connection closed with error:', err);
    else console.log('[SignalR] Connection closed');
  });

  await connection.start();
  connectionToken = token;
  console.log('[SignalR] Connected ✓');
  return connection;
}

export async function stopConnection(): Promise<void> {
  if (connection) {
    connectionToken = null;
    await connection.stop().catch(() => {});
    connection = null;
    console.log('[SignalR] Disconnected');
  }
}
