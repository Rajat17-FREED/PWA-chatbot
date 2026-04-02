import { useEffect, useRef, useCallback } from 'react';

/**
 * Auto-scroll hook that scrolls the container so the latest assistant message
 * is visible at the TOP of the viewport, rather than scrolling to the very bottom.
 *
 * - When loading (typing indicator), scrolls to the bottom so the indicator is visible.
 * - When a new message arrives (messages.length changes), scrolls the last assistant
 *   message to the top of the container.
 */
export function useAutoScroll(deps: unknown[], isLoading?: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef<number>(0);

  const scrollToLatestResponse = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Find all assistant message elements
    const assistantMessages = container.querySelectorAll('.freed-message--assistant');
    if (assistantMessages.length === 0) {
      // Fallback: scroll to bottom
      container.scrollTop = container.scrollHeight;
      return;
    }

    const lastAssistant = assistantMessages[assistantMessages.length - 1] as HTMLElement;

    // Calculate the offset of the last assistant message relative to the container
    // Subtract a small margin so it doesn't stick to the very top
    const offsetTop = lastAssistant.offsetTop - container.offsetTop - 8;
    container.scrollTo({ top: offsetTop, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const messageCount = typeof deps[0] === 'number' ? deps[0] : 0;
    const loading = isLoading ?? deps[1];

    if (loading) {
      // While loading/typing, keep the bottom visible so the typing indicator shows
      container.scrollTop = container.scrollHeight;
    } else if (messageCount > lastMessageCountRef.current) {
      // New message arrived — scroll to the top of the latest assistant response
      // Use requestAnimationFrame to wait for DOM render
      requestAnimationFrame(() => {
        scrollToLatestResponse();
      });
    }

    lastMessageCountRef.current = messageCount;
  }, deps);

  return containerRef;
}
