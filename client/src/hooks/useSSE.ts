import { useEffect, useState, useRef } from 'react';

export interface SSEEvent {
  type: string;
  data: any;
  timestamp: string;
}

export function useSSE(onEvent?: (event: SSEEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connect = () => {
      try {
        const baseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
        es = new EventSource(`${baseUrl}/api/events/subscribe`);
        eventSourceRef.current = es;

        es.onopen = () => {
          setIsConnected(true);
        };

        es.onmessage = (e) => {
          try {
            const parsed = JSON.parse(e.data);
            setLastEvent(parsed);
            if (onEvent) {
              onEvent(parsed);
            }
          } catch {
            // Heartbeat or malformed comment
          }
        };

        es.onerror = () => {
          setIsConnected(false);
          es?.close();
          // Auto reconnect after 3 seconds
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch (err) {
        setIsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) es.close();
    };
  }, []);

  return { isConnected, lastEvent };
}
